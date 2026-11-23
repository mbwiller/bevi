// places: the fallback behind the place picker (BEV-22).
//
// Bevi searches its own `venues` table first (`venues_search`, a plain RPC the
// app calls directly). This function is what "search more places" reaches when
// that misses: it asks Google's Places API (New) for the place, and when the
// user picks a result it becomes a row of `venues`, so the next person to
// search for it finds it in our table and never comes here.
//
// Three actions, all POST:
//
//   { action: "search", query, lat?, lng? }  -> { places: [...] }
//       Text Search. Results are shown to the caller and not stored.
//   { action: "add", placeId }               -> { venue }
//       Place Details for that id, then `upsert_google_venue`. The name and
//       the position are read from Google HERE rather than taken from the
//       request, so a client cannot write a venue of its own invention.
//   { action: "refresh" }                    -> { refreshed, failed }
//       Service role only. Re-reads the google venues whose copy is due
//       (`google_venues_due`), because the name and position of a Places
//       result may only be kept for a limited time; the place id is what
//       Google lets us keep.
//
// WHO MAY CALL IT. verify_jwt is on (config.toml), but that only proves the
// token was signed by this project, and the publishable key is such a token.
// `search` and `add` therefore start by calling `assert_places_rate()` AS THE
// CALLER: it raises for a token with no user, and it is the rate limit (60 an
// hour), since every call here is a billed request.
//
// WHAT GOOGLE IS TOLD ABOUT THE CALLER: the query, and a position rounded to
// about a hundred metres as a bias. Nothing that identifies them, and the
// position is not stored by us (20261119193000).
//
// This file is pure: everything it needs arrives through `Deps`, so test.ts
// drives the whole handler with a fake `fetch` and no request leaves the
// process. index.ts is the three lines that give it the real ones.

export interface Env {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /** Google Maps Platform key with the Places API (New) enabled. Absent: 503 `not_configured`. */
  googleKey: string | null;
}

export interface Deps {
  env: Env | null;
  fetch: typeof fetch;
}

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const GOOGLE = "https://places.googleapis.com/v1";
/**
 * The fields of a result we show or keep. The first four are in the Pro SKU, nothing from
 * Enterprise. `primaryType` and `types` (the place's glyph) were added on the understanding that
 * they bill the same way: check Google's field table before the key goes live, and drop them here
 * if they do not, which only costs a new venue its glyph.
 */
const FIELDS = ["id", "displayName", "formattedAddress", "location", "primaryType", "types"] as const;
const MAX_QUERY = 80;
const MAX_RESULTS = 8;
/** How far from the caller a result may be before the bias stops preferring it, in metres. */
const BIAS_RADIUS_M = 5000;
/** Place ids are opaque; this is only "looks like one", to keep junk out of a URL path. */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
/**
 * How long a call to Google may take, body included, before it counts as Google failing. A
 * timeout lands in the same catch as a network error: `upstream` to a caller, `failed` in refresh.
 */
const GOOGLE_TIMEOUT_MS = 8_000;

/** What kind of place a venue is (`venues.place_type`): the glyph on a pin and a picker row. */
export type PlaceType = "cafe" | "store" | "bar" | "liquor" | "restaurant" | "other";

const GOOGLE_TYPES: Readonly<Record<string, PlaceType>> = {
  cafe: "cafe",
  coffee_shop: "cafe",
  tea_house: "cafe",
  juice_shop: "cafe",
  bakery: "cafe",
  donut_shop: "cafe",
  bagel_shop: "cafe",
  bar: "bar",
  pub: "bar",
  wine_bar: "bar",
  night_club: "bar",
  bar_and_grill: "bar",
  liquor_store: "liquor",
  convenience_store: "store",
  supermarket: "store",
  grocery_store: "store",
  food_store: "store",
  market: "store",
  drugstore: "store",
  pharmacy: "store",
  gas_station: "store",
  department_store: "store",
  discount_store: "store",
  warehouse_store: "store",
  restaurant: "restaurant",
  meal_takeaway: "restaurant",
  meal_delivery: "restaurant",
  food_court: "restaurant",
  deli: "restaurant",
  diner: "restaurant",
  sandwich_shop: "restaurant",
};

const typeOf = (google: string | undefined): PlaceType =>
  !google ? "other" : (GOOGLE_TYPES[google] ?? (google.endsWith("_restaurant") ? "restaurant" : "other"));

/**
 * Our place type for a Google place: its primary type when we know it, else the first of its other
 * types that we do. A type Google adds later is "other" until it is listed here, which only costs
 * the venue a plainer glyph.
 */
export function placeTypeOf(place: { primaryType?: string; types?: readonly string[] }): PlaceType {
  const primary = typeOf(place.primaryType);
  if (primary !== "other") return primary;
  for (const t of place.types ?? []) {
    const known = typeOf(t);
    if (known !== "other") return known;
  }
  return "other";
}

export interface ExternalPlace {
  placeId: string;
  name: string;
  placeType: PlaceType;
  address: string | null;
  lat: number;
  lng: number;
  distanceMeters: number | null;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const fail = (status: number, error: string, message?: string): Response =>
  json(message ? { error, message } : { error }, status);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Constant-time comparison, so a wrong token leaks nothing by how long it took (as in embed). */
function tokensMatch(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A position on the Earth, or null: half a position, or one off the planet, is no position. */
export function readPosition(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (!finite(lat) || !finite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Three decimals, about 110 m: enough to bias a search, not enough to place a person. */
export const coarse = (degrees: number): number => Math.round(degrees * 1000) / 1000;

/** Metres between two positions (haversine), as `private.distance_m` computes it. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A Google place as the contract's `ExternalPlace`, or null when it lacks an id, a name or a position. */
export function toExternalPlace(place: GooglePlace, near: { lat: number; lng: number } | null): ExternalPlace | null {
  const name = place.displayName?.text?.trim();
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!place.id || !name || !finite(lat) || !finite(lng)) return null;
  return {
    placeId: place.id,
    name,
    placeType: placeTypeOf(place),
    address: place.formattedAddress?.trim() || null,
    lat,
    lng,
    distanceMeters: near ? Math.round(distanceMeters(near, { lat, lng })) : null,
  };
}

/** The Text Search request for a query, biased towards a coarsened position when there is one. */
export function searchRequest(query: string, near: { lat: number; lng: number } | null): Record<string, unknown> {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: MAX_RESULTS };
  if (near) {
    body.locationBias = {
      circle: { center: { latitude: coarse(near.lat), longitude: coarse(near.lng) }, radius: BIAS_RADIUS_M },
    };
  }
  return body;
}

function bearer(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** A Postgres function through PostgREST, as whoever `token` is. */
async function rpc(deps: Deps, env: Env, token: string, name: string, args: unknown): Promise<Response> {
  return await deps.fetch(`${env.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
}

/** `assert_places_rate()` as the caller: null when they may go on, else the response to send. */
async function meter(deps: Deps, env: Env, jwt: string): Promise<Response | null> {
  if (!jwt) return fail(401, "unauthorized");
  let res: Response;
  try {
    res = await rpc(deps, env, jwt, "assert_places_rate", {});
  } catch {
    return fail(503, "unavailable");
  }
  if (res.ok) return null;
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    code = body.code ?? "";
    message = body.message ?? "";
  } catch {
    // Not JSON: treated as unavailable below.
  }
  if (code === "P0001" || message.includes("BEVI_RATE_LIMITED")) return fail(429, "rate_limited");
  if (res.status === 401 || res.status === 403 || code === "42501" || message.includes("BEVI_UNAUTHORIZED")) {
    return fail(401, "unauthorized");
  }
  return fail(503, "unavailable");
}

/** Place Details for one id: the place, "missing" when Google has no such id, or "error". */
async function details(deps: Deps, key: string, placeId: string): Promise<GooglePlace | "missing" | "error"> {
  let res: Response;
  try {
    res = await deps.fetch(`${GOOGLE}/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS.join(",") },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch {
    return "error";
  }
  // Google answers an id it does not know with 404. A 400 is not "missing": the id has already
  // passed PLACE_ID_RE, and 400 is also how Google answers a bad or restricted key.
  if (res.status === 404) return "missing";
  if (!res.ok) return "error";
  try {
    const place: unknown = await res.json();
    return isObject(place) ? (place as GooglePlace) : "error";
  } catch {
    return "error";
  }
}

/** `upsert_google_venue` as the service role: the venue JSON, "hidden" for BEVI_NOT_FOUND, or "error". */
async function upsert(deps: Deps, env: Env, place: ExternalPlace): Promise<unknown | "hidden" | "error"> {
  let res: Response;
  try {
    res = await rpc(deps, env, env.serviceRoleKey, "upsert_google_venue", {
      p_place_id: place.placeId,
      p_name: place.name,
      p_lat: place.lat,
      p_lng: place.lng,
      p_address: place.address,
      p_place_type: place.placeType,
    });
  } catch {
    return "error";
  }
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      return "error";
    }
  }
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code === "P0002" || (body.message ?? "").includes("BEVI_NOT_FOUND")) return "hidden";
  } catch {
    // Falls through.
  }
  return "error";
}

async function search(deps: Deps, env: Env, key: string, body: Record<string, unknown>): Promise<Response> {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > MAX_QUERY) return fail(400, "validation", "query");
  const near = readPosition(body.lat, body.lng);

  let res: Response;
  try {
    res = await deps.fetch(`${GOOGLE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS.map((f) => `places.${f}`).join(","),
      },
      body: JSON.stringify(searchRequest(query, near)),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch {
    return fail(502, "upstream");
  }
  if (!res.ok) return fail(502, "upstream");

  let found: unknown;
  try {
    found = await res.json();
  } catch {
    return fail(502, "upstream");
  }
  // Google leaves `places` out when nothing matched; a body that is not an object is not an answer.
  if (!isObject(found)) return fail(502, "upstream");
  const listed: unknown[] = Array.isArray(found.places) ? found.places : [];
  const places = listed.flatMap((p) => {
    const place = isObject(p) ? toExternalPlace(p as GooglePlace, near) : null;
    return place ? [place] : [];
  });
  return json({ places }, 200);
}

async function add(deps: Deps, env: Env, key: string, body: Record<string, unknown>): Promise<Response> {
  const placeId = typeof body.placeId === "string" ? body.placeId : "";
  if (!PLACE_ID_RE.test(placeId)) return fail(400, "validation", "placeId");

  const found = await details(deps, key, placeId);
  if (found === "missing") return fail(404, "not_found");
  if (found === "error") return fail(502, "upstream");
  const place = toExternalPlace(found, null);
  // A place with no name or no position cannot be a pin.
  if (!place) return fail(404, "not_found");

  const venue = await upsert(deps, env, place);
  if (venue === "hidden") return fail(404, "not_found");
  if (venue === "error") return fail(503, "unavailable");
  return json({ venue }, 200);
}

async function refresh(deps: Deps, env: Env, key: string): Promise<Response> {
  let due: unknown[];
  try {
    const res = await rpc(deps, env, env.serviceRoleKey, "google_venues_due", {});
    if (!res.ok) return fail(503, "unavailable");
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return fail(503, "unavailable");
    due = rows;
  } catch {
    return fail(503, "unavailable");
  }

  let refreshed = 0;
  let failed = 0;
  // One at a time: at most fifty a run, and no reason to hurry a batch job.
  for (const row of due) {
    const placeId = isObject(row) && typeof row.google_place_id === "string" ? row.google_place_id : "";
    if (!placeId) {
      failed += 1;
      continue;
    }
    // "error" also covers a Google call that timed out: that venue fails and the loop goes on.
    const found = await details(deps, key, placeId);
    const place = typeof found === "string" ? null : toExternalPlace(found, null);
    // A place Google no longer has keeps its row and its date: the next run
    // tries again, and the venue stays where its Bevs are.
    const saved = place ? await upsert(deps, env, { ...place, placeId }) : "error";
    // "hidden" (a venue hidden by hand since `google_venues_due` listed it) counts as refreshed:
    // nothing failed, it stays hidden, and as a hidden venue it is no longer due.
    if (saved === "error") failed += 1;
    else refreshed += 1;
  }
  // Every venue failing is a broken run (a bad key, Google down), not a quiet week: say so.
  return json({ refreshed, failed }, failed > 0 && refreshed === 0 ? 502 : 200);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  const env = deps.env;
  if (!env) return fail(503, "not_configured");

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return fail(400, "validation", "body");
  }

  const action = body.action;
  const token = bearer(req);

  if (action === "refresh") {
    // The service role key itself, compared whole: a user's JWT never refreshes.
    if (!token || !tokensMatch(token, env.serviceRoleKey)) return fail(403, "forbidden");
    if (!env.googleKey) return fail(503, "not_configured");
    return await refresh(deps, env, env.googleKey);
  }

  if (action !== "search" && action !== "add") return fail(400, "validation", "action");

  const refused = await meter(deps, env, token);
  if (refused) return refused;
  if (!env.googleKey) return fail(503, "not_configured");

  return action === "search"
    ? await search(deps, env, env.googleKey, body)
    : await add(deps, env, env.googleKey, body);
}

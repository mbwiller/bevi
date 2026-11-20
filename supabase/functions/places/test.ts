// Deno tests for places. Run with:
//   deno test --allow-net --allow-env supabase/functions/places/
//
// They import ./core.ts, never ./index.ts, so nothing starts a server, and the
// handler's `fetch` is a fake that answers by URL: no request leaves the
// process and no key is needed.
//
// What is NOT covered here: Google's real answers, and the Postgres half
// (assert_places_rate, upsert_google_venue, google_venues_due), which is
// pgTAP's job in supabase/tests/43_bev_locations.test.sql.

import { assert, assertEquals } from "jsr:@std/assert@1";

import { coarse, distanceMeters, handle, readPosition, searchRequest, toExternalPlace, type Deps, type Env } from "./core.ts";

const ENV: Env = {
  url: "https://project.supabase.co",
  anonKey: "anon-key",
  serviceRoleKey: "service-role-key",
  googleKey: "google-key",
};

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const GOOGLE_PLACE = {
  id: PLACE_ID,
  displayName: { text: "Bread & Butter Market" },
  formattedAddress: "579 Main St, New York, NY 10044, USA",
  location: { latitude: 40.7617, longitude: -73.9497 },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (call: Call) => Response | Promise<Response>;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A `fetch` that records each call and answers from the first route whose key the URL contains. */
function fakeFetch(routes: Record<string, Route>, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const [key, route] of Object.entries(routes)) {
      if (url.includes(key)) return await route(call);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const post = (body: unknown, token = "user-jwt") =>
  new Request("https://project.supabase.co/functions/v1/places", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const deps = (routes: Record<string, Route>, calls: Call[] = [], env: Env | null = ENV): Deps => ({
  env,
  fetch: fakeFetch(routes, calls),
});

const METER_OK: Record<string, Route> = { "rpc/assert_places_rate": () => new Response(null, { status: 204 }) };

Deno.test("readPosition: two finite numbers on the Earth, or nothing", () => {
  assertEquals(readPosition(40.76, -73.95), { lat: 40.76, lng: -73.95 });
  assertEquals(readPosition(40.76, null), null);
  assertEquals(readPosition("40.76", -73.95), null);
  assertEquals(readPosition(91, 0), null);
  assertEquals(readPosition(0, 181), null);
  assertEquals(readPosition(Number.NaN, 0), null);
});

Deno.test("coarse: three decimals, so Google is told a block, not a doorway", () => {
  assertEquals(coarse(40.761694), 40.762);
  assertEquals(coarse(-73.949712), -73.95);
});

Deno.test("searchRequest: the query, capped results, and a coarse bias only with a position", () => {
  assertEquals(searchRequest("bread and butter", null), { textQuery: "bread and butter", maxResultCount: 8 });
  assertEquals(searchRequest("bread", { lat: 40.761694, lng: -73.949712 }), {
    textQuery: "bread",
    maxResultCount: 8,
    locationBias: { circle: { center: { latitude: 40.762, longitude: -73.95 }, radius: 5000 } },
  });
});

Deno.test("distanceMeters: a ten-thousandth of a degree of latitude is about eleven metres", () => {
  const d = distanceMeters({ lat: 53.34, lng: -6.26 }, { lat: 53.3401, lng: -6.26 });
  assert(d > 10.5 && d < 11.5, `got ${d}`);
});

Deno.test("toExternalPlace: the contract's shape, and null without an id, a name or a position", () => {
  assertEquals(toExternalPlace(GOOGLE_PLACE, null), {
    placeId: PLACE_ID,
    name: "Bread & Butter Market",
    address: "579 Main St, New York, NY 10044, USA",
    lat: 40.7617,
    lng: -73.9497,
    distanceMeters: null,
  });
  const near = toExternalPlace(GOOGLE_PLACE, { lat: 40.7617, lng: -73.9497 });
  assertEquals(near?.distanceMeters, 0);
  assertEquals(toExternalPlace({ ...GOOGLE_PLACE, id: undefined }, null), null);
  assertEquals(toExternalPlace({ ...GOOGLE_PLACE, displayName: { text: "  " } }, null), null);
  assertEquals(toExternalPlace({ ...GOOGLE_PLACE, location: { latitude: 40.76 } }, null), null);
  assertEquals(toExternalPlace({ ...GOOGLE_PLACE, formattedAddress: "" }, null)?.address, null);
});

Deno.test("OPTIONS is answered before anything else, with the allow headers", async () => {
  const res = await handle(new Request("https://x/functions/v1/places", { method: "OPTIONS" }), deps({}));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("anything but POST is 405, and a missing environment is 503", async () => {
  assertEquals((await handle(new Request("https://x/", { method: "GET" }), deps({}))).status, 405);
  const res = await handle(post({ action: "search", query: "x" }), deps({}, [], null));
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: "not_configured" });
});

Deno.test("an unknown action is a validation error and reaches nothing", async () => {
  const calls: Call[] = [];
  const res = await handle(post({ action: "delete" }), deps({}, calls));
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("search: metered as the caller first, then Google with a field mask and a coarse bias", async () => {
  const calls: Call[] = [];
  const res = await handle(
    post({ action: "search", query: "  bread  ", lat: 40.761694, lng: -73.949712 }),
    deps({ ...METER_OK, "places:searchText": () => ok({ places: [GOOGLE_PLACE, { id: "no-name" }] }) }, calls),
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assertEquals(body.places.length, 1);
  assertEquals(body.places[0].placeId, PLACE_ID);
  assert(body.places[0].distanceMeters < 20);

  assertEquals(calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, "")), [
    "/rest/v1/rpc/assert_places_rate",
    "/v1/places:searchText",
  ]);
  // The meter runs as the caller, not as the service role.
  assertEquals(calls[0].headers.authorization, "Bearer user-jwt");
  assertEquals(calls[1].headers["x-goog-api-key"], "google-key");
  assertEquals(
    calls[1].headers["x-goog-fieldmask"],
    "places.id,places.displayName,places.formattedAddress,places.location",
  );
  assertEquals(calls[1].body, {
    textQuery: "bread",
    maxResultCount: 8,
    locationBias: { circle: { center: { latitude: 40.762, longitude: -73.95 }, radius: 5000 } },
  });
});

Deno.test("search: no token, a token with no user, and a rate limit never reach Google", async () => {
  const noToken: Call[] = [];
  assertEquals((await handle(post({ action: "search", query: "x" }, ""), deps({}, noToken))).status, 401);
  assertEquals(noToken.length, 0);

  const anon: Call[] = [];
  const unauthorized = await handle(
    post({ action: "search", query: "x" }),
    deps({ "rpc/assert_places_rate": () => ok({ code: "42501", message: "BEVI_UNAUTHORIZED" }, 403) }, anon),
  );
  assertEquals(unauthorized.status, 401);
  assertEquals(anon.length, 1);

  const limited = await handle(
    post({ action: "search", query: "x" }),
    deps({ "rpc/assert_places_rate": () => ok({ code: "P0001", message: "BEVI_RATE_LIMITED" }, 400) }),
  );
  assertEquals(limited.status, 429);
  assertEquals(await limited.json(), { error: "rate_limited" });
});

Deno.test("search: an empty or over-long query is 400, a Google failure is 502, no key is 503", async () => {
  assertEquals((await handle(post({ action: "search", query: " " }), deps(METER_OK))).status, 400);
  assertEquals((await handle(post({ action: "search", query: "x".repeat(81) }), deps(METER_OK))).status, 400);

  const down = await handle(
    post({ action: "search", query: "x" }),
    deps({ ...METER_OK, "places:searchText": () => ok({ error: {} }, 500) }),
  );
  assertEquals(down.status, 502);

  const unreachable = await handle(
    post({ action: "search", query: "x" }),
    deps({ ...METER_OK, "places:searchText": () => { throw new TypeError("network"); } }),
  );
  assertEquals(unreachable.status, 502);

  const noKey = await handle(post({ action: "search", query: "x" }), deps(METER_OK, [], { ...ENV, googleKey: null }));
  assertEquals(noKey.status, 503);
  assertEquals(await noKey.json(), { error: "not_configured" });
});

Deno.test("add: reads the place from Google, then writes it as the service role", async () => {
  const calls: Call[] = [];
  const venue = { id: "00000000-0000-4000-8000-00000000d001", name: "Bread & Butter Market" };
  const res = await handle(
    // A name in the request is ignored: the venue is what Google says the id is.
    post({ action: "add", placeId: PLACE_ID, name: "Free Drinks Here", lat: 0, lng: 0 }),
    deps(
      {
        ...METER_OK,
        [`/v1/places/${PLACE_ID}`]: () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok(venue),
      },
      calls,
    ),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { venue });
  assertEquals(calls[1].headers["x-goog-fieldmask"], "id,displayName,formattedAddress,location");
  assertEquals(calls[2].headers.authorization, "Bearer service-role-key");
  assertEquals(calls[2].body, {
    p_place_id: PLACE_ID,
    p_name: "Bread & Butter Market",
    p_lat: 40.7617,
    p_lng: -73.9497,
    p_address: "579 Main St, New York, NY 10044, USA",
  });
});

Deno.test("add: a malformed id is 400; an unknown place, and a venue hidden by hand, are 404", async () => {
  const calls: Call[] = [];
  assertEquals((await handle(post({ action: "add", placeId: "../secrets" }), deps(METER_OK, calls))).status, 400);
  assertEquals(calls.length, 1);

  const unknown = await handle(
    post({ action: "add", placeId: PLACE_ID }),
    deps({ ...METER_OK, "/v1/places/": () => ok({ error: {} }, 404) }),
  );
  assertEquals(unknown.status, 404);

  const hidden = await handle(
    post({ action: "add", placeId: PLACE_ID }),
    deps({
      ...METER_OK,
      "/v1/places/": () => ok(GOOGLE_PLACE),
      "rpc/upsert_google_venue": () => ok({ code: "P0002", message: "BEVI_NOT_FOUND" }, 404),
    }),
  );
  assertEquals(hidden.status, 404);
});

Deno.test("refresh: the service role key only, and it is not metered", async () => {
  const asUser: Call[] = [];
  assertEquals((await handle(post({ action: "refresh" }), deps({}, asUser))).status, 403);
  assertEquals(asUser.length, 0);

  const calls: Call[] = [];
  const res = await handle(
    post({ action: "refresh" }, "service-role-key"),
    deps(
      {
        "rpc/google_venues_due": () => ok([{ google_place_id: PLACE_ID }, { google_place_id: "ChIJgone_gone_gone" }]),
        [`/v1/places/${PLACE_ID}`]: () => ok({ ...GOOGLE_PLACE, displayName: { text: "Bread & Butter" } }),
        "/v1/places/ChIJgone_gone_gone": () => ok({ error: {} }, 404),
        "rpc/upsert_google_venue": () => ok({ id: "v" }),
      },
      calls,
    ),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { refreshed: 1, failed: 1 });
  assert(!calls.some((c) => c.url.includes("assert_places_rate")));
  const writes = calls.filter((c) => c.url.includes("upsert_google_venue"));
  assertEquals(writes.length, 1);
  assertEquals((writes[0].body as { p_name: string }).p_name, "Bread & Butter");
});

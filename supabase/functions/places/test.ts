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

import { coarse, distanceMeters, handle, placeTypeOf, readPosition, searchRequest, toExternalPlace, type Deps, type Env } from "./core.ts";

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
  primaryType: "grocery_store",
  types: ["grocery_store", "food_store", "store"],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null;
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
      signal: init?.signal ?? null,
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

/** PostgREST's answer to a signed-in user calling a function granted to service_role only. */
const REFUSED_AS_USER: Record<string, Route> = {
  "rpc/google_venues_due": () => ok({ code: "42501", message: "permission denied for function google_venues_due" }, 403),
};

/** What `fetch` rejects with when an `AbortSignal.timeout` fires. The fake never waits, so it throws this itself. */
const timedOut: Route = () => {
  throw new DOMException("Signal timed out.", "TimeoutError");
};

/** A 200 whose body is not JSON, as a captive portal or a misrouted proxy would send. */
const notJson: Route = () => new Response("<html>oops</html>", { status: 200, headers: { "Content-Type": "text/html" } });

/** The response is the function's own error, with the CORS headers a browser needs to read it. */
async function assertFailure(res: Response, status: number, error: string): Promise<void> {
  assertEquals(res.status, status);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { error });
}

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

Deno.test("placeTypeOf: Google's type becomes ours, the primary one first, and an unknown one is other", () => {
  assertEquals(placeTypeOf({ primaryType: "coffee_shop" }), "cafe");
  assertEquals(placeTypeOf({ primaryType: "pub" }), "bar");
  assertEquals(placeTypeOf({ primaryType: "liquor_store" }), "liquor");
  assertEquals(placeTypeOf({ primaryType: "drugstore" }), "store");
  assertEquals(placeTypeOf({ primaryType: "italian_restaurant" }), "restaurant");
  // The primary type wins over the list; the list answers when the primary says nothing we know.
  assertEquals(placeTypeOf({ primaryType: "bar", types: ["restaurant", "bar"] }), "bar");
  assertEquals(placeTypeOf({ primaryType: "establishment", types: ["point_of_interest", "cafe"] }), "cafe");
  assertEquals(placeTypeOf({ primaryType: "stadium", types: ["stadium", "point_of_interest"] }), "other");
  assertEquals(placeTypeOf({}), "other");
});

Deno.test("toExternalPlace: the contract's shape, and null without an id, a name or a position", () => {
  assertEquals(toExternalPlace(GOOGLE_PLACE, null), {
    placeId: PLACE_ID,
    name: "Bread & Butter Market",
    placeType: "store",
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
  // Every call to Google carries a timeout.
  assert(calls[1].signal instanceof AbortSignal);
  assertEquals(
    calls[1].headers["x-goog-fieldmask"],
    "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types",
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
  assertEquals(calls[1].headers["x-goog-fieldmask"], "id,displayName,formattedAddress,location,primaryType,types");
  assert(calls[1].signal instanceof AbortSignal);
  assertEquals(calls[2].headers.authorization, "Bearer service-role-key");
  // The service key in both headers, as every other function of ours sends its own.
  assertEquals(calls[2].headers.apikey, "service-role-key");
  assertEquals(calls[2].body, {
    p_place_id: PLACE_ID,
    p_name: "Bread & Butter Market",
    p_lat: 40.7617,
    p_lng: -73.9497,
    p_address: "579 Main St, New York, NY 10044, USA",
    p_place_type: "store",
  });
});

Deno.test("add: an opaque secret key the platform injects goes in both headers of the write", async () => {
  const calls: Call[] = [];
  const opaque = "sb_secret_injected";
  const res = await handle(
    post({ action: "add", placeId: PLACE_ID }),
    deps(
      {
        ...METER_OK,
        [`/v1/places/${PLACE_ID}`]: () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok({ id: "v" }),
      },
      calls,
      { ...ENV, serviceRoleKey: opaque },
    ),
  );
  assertEquals(res.status, 200);
  const write = calls.find((c) => c.url.includes("upsert_google_venue"))!;
  assertEquals(write.headers.authorization, `Bearer ${opaque}`);
  assertEquals(write.headers.apikey, opaque);
  // The caller's own token still meters the call, with the publishable key beside it.
  assertEquals(calls[0].headers.authorization, "Bearer user-jwt");
  assertEquals(calls[0].headers.apikey, "anon-key");
});

Deno.test("add: a failed step is logged with its status and code, and never a key", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const refused = await handle(
      post({ action: "add", placeId: PLACE_ID }),
      deps({
        ...METER_OK,
        "/v1/places/": () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok({ code: "PGRST301", message: "JWT could not be decoded" }, 401),
      }),
    );
    await assertFailure(refused, 503, "unavailable");

    const denied = await handle(
      post({ action: "add", placeId: PLACE_ID }),
      deps({
        ...METER_OK,
        "/v1/places/": () => ok({ error: { status: "PERMISSION_DENIED", message: "key google-key is restricted" } }, 403),
      }),
    );
    await assertFailure(denied, 502, "upstream");
  } finally {
    console.error = original;
  }
  assertEquals(logged, [
    "places: upsert_google_venue failed status=401 code=PGRST301",
    "places: google details failed status=403 reason=PERMISSION_DENIED",
  ]);
  for (const line of logged) {
    assert(!line.includes("service-role-key") && !line.includes("google-key") && !line.includes("anon-key"));
  }
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
  assertEquals((await handle(post({ action: "refresh" }), deps(REFUSED_AS_USER, asUser))).status, 403);
  assertEquals(asUser.map((c) => c.url.replace(/^https:\/\/[^/]+/, "")), ["/rest/v1/rpc/google_venues_due"]);

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

Deno.test("search: a Google call that times out is 502 upstream, with the CORS headers", async () => {
  const res = await handle(post({ action: "search", query: "x" }), deps({ ...METER_OK, "places:searchText": timedOut }));
  await assertFailure(res, 502, "upstream");
});

Deno.test("search: a 200 from Google that is not JSON, or not an object, is 502 upstream", async () => {
  await assertFailure(
    await handle(post({ action: "search", query: "x" }), deps({ ...METER_OK, "places:searchText": notJson })),
    502,
    "upstream",
  );
  await assertFailure(
    await handle(post({ action: "search", query: "x" }), deps({ ...METER_OK, "places:searchText": () => ok(null) })),
    502,
    "upstream",
  );
  // No `places` is Google's way of saying nothing matched, and junk in the list is dropped.
  const empty = await handle(
    post({ action: "search", query: "x" }),
    deps({ ...METER_OK, "places:searchText": () => ok({ places: [null, 7, GOOGLE_PLACE] }) }),
  );
  assertEquals(empty.status, 200);
  assertEquals((await empty.json()).places.length, 1);
  const none = await handle(post({ action: "search", query: "x" }), deps({ ...METER_OK, "places:searchText": () => ok({}) }));
  assertEquals(await none.json(), { places: [] });
});

Deno.test("add: a Google call that times out is 502 upstream, with the CORS headers", async () => {
  const calls: Call[] = [];
  const res = await handle(post({ action: "add", placeId: PLACE_ID }), deps({ ...METER_OK, "/v1/places/": timedOut }, calls));
  await assertFailure(res, 502, "upstream");
  assert(!calls.some((c) => c.url.includes("upsert_google_venue")));
});

Deno.test("add: a Google 400 is a fault (a bad key answers 400), not a missing place", async () => {
  const res = await handle(
    post({ action: "add", placeId: PLACE_ID }),
    deps({ ...METER_OK, "/v1/places/": () => ok({ error: { code: 400, status: "INVALID_ARGUMENT" } }, 400) }),
  );
  await assertFailure(res, 502, "upstream");
});

Deno.test("add: a body from Google or PostgREST that is not JSON is a failure with CORS, not a crash", async () => {
  await assertFailure(
    await handle(post({ action: "add", placeId: PLACE_ID }), deps({ ...METER_OK, "/v1/places/": notJson })),
    502,
    "upstream",
  );
  await assertFailure(
    await handle(
      post({ action: "add", placeId: PLACE_ID }),
      deps({ ...METER_OK, "/v1/places/": () => ok(GOOGLE_PLACE), "rpc/upsert_google_venue": notJson }),
    ),
    503,
    "unavailable",
  );
});

Deno.test("refresh: a token the database refuses is 403 forbidden, and Google is never called", async () => {
  const refusals: Route[] = [
    // A user's JWT: the role has no EXECUTE on google_venues_due.
    REFUSED_AS_USER["rpc/google_venues_due"],
    // The anon role (the publishable key as the bearer): the same code, as a 401.
    () => ok({ code: "42501", message: "permission denied for function google_venues_due" }, 401),
    // A token PostgREST cannot verify at all.
    () => ok({ code: "PGRST301", message: "JWSError JWSInvalidSignature" }, 401),
    // The gateway refusing the key, with no PostgREST body.
    () => new Response("Invalid API key", { status: 401 }),
  ];
  for (const [i, refusal] of refusals.entries()) {
    for (const token of ["service-role-kez", "service-role-key-and-more", "s"]) {
      const calls: Call[] = [];
      const routes = { "rpc/google_venues_due": refusal, "/v1/places/": () => ok(GOOGLE_PLACE) };
      await assertFailure(await handle(post({ action: "refresh" }, token), deps(routes, calls)), 403, "forbidden");
      assertEquals(calls.length, 1, `refusal ${i}, token ${token}`);
      assertEquals(calls[0].headers.authorization, `Bearer ${token}`);
    }
  }
});

Deno.test("refresh: no token is 403 forbidden before anything is called", async () => {
  const calls: Call[] = [];
  await assertFailure(await handle(post({ action: "refresh" }, ""), deps({}, calls)), 403, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("refresh: a service-role token other than the function's own key, accepted by the database, refreshes", async () => {
  const calls: Call[] = [];
  const res = await handle(
    post({ action: "refresh" }, "another-service-role-jwt"),
    deps(
      {
        "rpc/google_venues_due": () => ok([{ google_place_id: PLACE_ID }]),
        [`/v1/places/${PLACE_ID}`]: () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok({ id: "v" }),
      },
      calls,
    ),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { refreshed: 1, failed: 0 });
  assertEquals(calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, "")), [
    "/rest/v1/rpc/google_venues_due",
    `/v1/places/${PLACE_ID}`,
    "/rest/v1/rpc/upsert_google_venue",
  ]);
  // Both database calls are the caller's, never the function's own service role key.
  for (const c of [calls[0], calls[2]]) {
    assertEquals(c.headers.authorization, "Bearer another-service-role-jwt");
    assertEquals(c.headers.apikey, "anon-key");
  }
  assertEquals(calls[1].headers["x-goog-api-key"], "google-key");
});

Deno.test("refresh: an opaque Supabase key as the bearer is also sent as the apikey", async () => {
  // Assembled at runtime so the file never holds a key-shaped literal (as in bug-report's tests).
  const opaque = ["sb_", "secret_", "fake"].join("");
  const calls: Call[] = [];
  const res = await handle(
    post({ action: "refresh" }, opaque),
    deps(
      {
        "rpc/google_venues_due": () => ok([{ google_place_id: PLACE_ID }]),
        [`/v1/places/${PLACE_ID}`]: () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok({ id: "v" }),
      },
      calls,
    ),
  );
  assertEquals(res.status, 200);
  for (const c of calls.filter((c) => c.url.includes("/rest/v1/"))) {
    assertEquals(c.headers.authorization, `Bearer ${opaque}`);
    assertEquals(c.headers.apikey, opaque);
  }
});

Deno.test("refresh: a database failure that is not a refusal is 503 unavailable, and Google is never called", async () => {
  const faults: Route[] = [
    () => ok({ code: "XX000", message: "internal error" }, 500),
    // The function missing from the schema cache (the migration not applied) is a fault, not a refusal.
    () => ok({ code: "PGRST202", message: "Could not find the function" }, 404),
    () => new Response("<html>bad gateway</html>", { status: 502 }),
    () => {
      throw new TypeError("network");
    },
  ];
  for (const [i, fault] of faults.entries()) {
    const calls: Call[] = [];
    const routes = { "rpc/google_venues_due": fault, "/v1/places/": () => ok(GOOGLE_PLACE) };
    await assertFailure(await handle(post({ action: "refresh" }, "service-role-key"), deps(routes, calls)), 503, "unavailable");
    assertEquals(calls.length, 1, `fault ${i}`);
  }
});

Deno.test("refresh: no Google key is 503 not_configured, but only after the database accepts the caller", async () => {
  const noKey = { ...ENV, googleKey: null };
  const accepted: Call[] = [];
  await assertFailure(
    await handle(post({ action: "refresh" }, "service-role-key"), deps({ "rpc/google_venues_due": () => ok([{ google_place_id: PLACE_ID }]) }, accepted, noKey)),
    503,
    "not_configured",
  );
  assertEquals(accepted.length, 1);

  await assertFailure(await handle(post({ action: "refresh" }), deps(REFUSED_AS_USER, [], noKey)), 403, "forbidden");
});

Deno.test("refresh: every venue failing is 502 with the counts, so the weekly job goes red", async () => {
  const res = await handle(
    post({ action: "refresh" }, "service-role-key"),
    deps({
      "rpc/google_venues_due": () => ok([{ google_place_id: PLACE_ID }, { google_place_id: "ChIJgone_gone_gone" }]),
      // A bad key: Google answers every id with 400.
      "/v1/places/": () => ok({ error: { code: 400 } }, 400),
    }),
  );
  assertEquals(res.status, 502);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { refreshed: 0, failed: 2 });
});

Deno.test("refresh: a venue that times out fails, the loop goes on, and a part success is 200", async () => {
  const calls: Call[] = [];
  const res = await handle(
    post({ action: "refresh" }, "service-role-key"),
    deps(
      {
        "rpc/google_venues_due": () => ok([{ google_place_id: "ChIJslow_slow_slow" }, { google_place_id: PLACE_ID }]),
        "/v1/places/ChIJslow_slow_slow": timedOut,
        [`/v1/places/${PLACE_ID}`]: () => ok(GOOGLE_PLACE),
        "rpc/upsert_google_venue": () => ok({ id: "v" }),
      },
      calls,
    ),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { refreshed: 1, failed: 1 });
  assert(calls.filter((c) => c.url.includes("/v1/places/")).every((c) => c.signal instanceof AbortSignal));
});

Deno.test("refresh: nothing due is a quiet 200, and a due list that is not a list is 503", async () => {
  const quiet = await handle(post({ action: "refresh" }, "service-role-key"), deps({ "rpc/google_venues_due": () => ok([]) }));
  assertEquals(quiet.status, 200);
  assertEquals(await quiet.json(), { refreshed: 0, failed: 0 });

  await assertFailure(
    await handle(post({ action: "refresh" }, "service-role-key"), deps({ "rpc/google_venues_due": notJson })),
    503,
    "unavailable",
  );
  await assertFailure(
    await handle(post({ action: "refresh" }, "service-role-key"), deps({ "rpc/google_venues_due": () => ok({ rows: [] }) })),
    503,
    "unavailable",
  );
});

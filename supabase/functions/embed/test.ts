// Deno tests for the embedded-text template (A-16 (1), decision 30). Run with:
//   deno test supabase/functions/embed/test.ts
//
// These need no network, no database and no Edge Runtime: they import
// `./text.ts`, not `./index.ts`, so nothing starts a server and `Supabase.ai`
// is never touched. The parts that do need a deployed function -- the 401, the
// upsert, the 384 values `gte-small` actually returns -- cannot be checked
// here and are listed in the PR instead.

import { assertEquals } from "jsr:@std/assert@1";
import { DIMENSIONS, embeddingText, MAX_BATCH, MODEL } from "./text.ts";

Deno.test("the template is brand, name, flavour, category, in that order", () => {
  assertEquals(
    embeddingText({ brand: "Coca-Cola", name: "Coke", flavor: "Cherry", category_id: "soda" }),
    "Coca-Cola Coke Cherry soda",
  );
});

Deno.test("a null brand or flavour is omitted rather than left as a blank slot", () => {
  assertEquals(
    embeddingText({ brand: null, name: "Tap Water", flavor: null, category_id: "water" }),
    "Tap Water water",
  );
});

Deno.test("a blank brand or flavour collapses away too", () => {
  assertEquals(
    embeddingText({ brand: "  ", name: "Seltzer", flavor: "", category_id: "sparkling_water" }),
    "Seltzer sparkling water",
  );
});

Deno.test("the category slug's underscores and hyphens become spaces", () => {
  assertEquals(
    embeddingText({ brand: "Topo Chico", name: "Mineral Water", flavor: null, category_id: "sparkling_water" }),
    "Topo Chico Mineral Water sparkling water",
  );
  assertEquals(
    embeddingText({ brand: null, name: "Old Fashioned", flavor: null, category_id: "spirits_cocktails" }),
    "Old Fashioned spirits cocktails",
  );
});

Deno.test("interior whitespace is collapsed and the result trimmed", () => {
  assertEquals(
    embeddingText({ brand: " Red  Bull ", name: "Energy\tDrink", flavor: null, category_id: "energy" }),
    "Red Bull Energy Drink energy",
  );
});

Deno.test("the model and dimensions are the ones decision 30 fixes", () => {
  assertEquals(MODEL, "gte-small");
  assertEquals(DIMENSIONS, 384);
});

Deno.test("the batch bound is small enough for one 2s CPU budget", () => {
  // 4 is measured, not guessed: 16 per request failed 21 of 24 batches with
  // 546 WORKER_RESOURCE_LIMIT against the deployed function, and 4 embedded
  // all 378 seeded Bevs with no failures. Raising this needs the same
  // experiment again, not an argument.
  assertEquals(MAX_BATCH <= 4, true);
  assertEquals(MAX_BATCH >= 1, true);
});

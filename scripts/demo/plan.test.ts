/**
 * Unit tests for the IA-8 demo plan (scripts/demo/plan.ts). No database, no
 * network, no key -- `buildPlan()` is pure, so everything the seeder would
 * write can be checked here first.
 *
 *   node --experimental-strip-types --test scripts/demo/plan.test.ts
 *   npm run test:scripts
 *
 * The two that matter most to a release:
 *
 *  - the forbidden-string test reads `FORBIDDEN` straight out of
 *    `app/scripts/check-bundle.mjs` (which fails a build whose bundle contains
 *    a test fixture) and fails if any seeded name, handle, note or comment
 *    drifts into it, or starts to look like the jest FakeApi's people;
 *  - the leaderboard and Recommended tests read `MIN_RATERS` and `MIN_N_USER`
 *    from `@bevi/ranking`, so a constant change there surfaces as a failing
 *    test rather than as an empty screen in front of a reviewer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MIN_N_USER, MIN_RATERS } from "@bevi/ranking";

import { loadBevRows } from "../catalog/catalog.ts";
import { BUCKET_DB, DEMO_HANDLE, buildPlan, planStrings } from "./plan.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** A Wednesday, so nothing depends on the day a test runs. */
const NOW = new Date("2026-11-18T22:40:00Z");

test("the plan resolves, and every Bev in it is a real catalog row", () => {
  const plan = buildPlan(NOW);
  const slugs = new Set(loadBevRows().map((r) => r.slug));
  for (const p of plan.people) {
    for (const r of p.rankings) assert.ok(slugs.has(r.bev.slug), `${r.bev.slug} is not in data/catalog/bevs.csv`);
    for (const w of p.wantToTry) assert.ok(slugs.has(w.slug), `${w.slug} is not in data/catalog/bevs.csv`);
  }
  assert.equal(plan.summary.people, plan.people.length);
  assert.ok(plan.summary.rankings > 50, `only ${plan.summary.rankings} rankings`);
});

test("nothing in the plan is a check-bundle forbidden string, or a FakeApi fixture name", () => {
  const checkBundle = readFileSync(join(ROOT, "app", "scripts", "check-bundle.mjs"), "utf8");
  const block = /const FORBIDDEN = \[([\s\S]*?)\];/.exec(checkBundle);
  assert.ok(block, "could not find FORBIDDEN in app/scripts/check-bundle.mjs");
  const forbidden = [...(block[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  assert.ok(forbidden.length >= 10, `only ${forbidden.length} forbidden strings parsed`);

  const strings = planStrings(buildPlan(NOW));
  for (const s of strings) {
    for (const bad of forbidden) {
      assert.ok(!s.includes(bad), `the plan writes "${s}", which contains check-bundle's forbidden "${bad}"`);
    }
  }
  // The jest FakeApi's people (app/src/testing/fakeApi/people.ts): tester,
  // friend_a..e, minor_user, "Test User", "Friend A". A seeded person must not
  // read like one of them either.
  for (const s of strings) {
    assert.ok(!/^(tester|friend_[a-z]|minor_user)$/i.test(s), `"${s}" looks like a FakeApi fixture handle`);
    assert.ok(!/^(test user|friend [a-z]|minor user)$/i.test(s), `"${s}" looks like a FakeApi fixture name`);
  }
});

test("the demo account can fill every screen App Review will open", () => {
  const plan = buildPlan(NOW);
  const demo = plan.people.find((p) => p.handle === DEMO_HANDLE);
  assert.ok(demo, "no demo person");

  // Your Lists: all three buckets, plus Want to Try.
  for (const bucket of ["LOVED", "FINE", "DISLIKED"] as const) {
    assert.ok(demo.rankings.some((r) => r.bucket === bucket), `${bucket} is empty`);
  }
  assert.ok(demo.wantToTry.length >= 3, `Want to Try has ${demo.wantToTry.length}`);

  // Recommended: packages/api returns [] below MIN_N_USER rankings.
  assert.ok(demo.rankings.length >= MIN_N_USER, `${demo.rankings.length} rankings < MIN_N_USER ${MIN_N_USER}`);

  // Leaderboard: a Bev needs MIN_RATERS raters to be eligible.
  const raters = new Map<string, number>();
  for (const p of plan.people) for (const r of p.rankings) raters.set(r.bev.slug, (raters.get(r.bev.slug) ?? 0) + 1);
  const eligible = [...raters.values()].filter((n) => n >= MIN_RATERS).length;
  assert.equal(eligible, plan.summary.leaderboardEligible);
  assert.ok(eligible >= 10, `only ${eligible} Bev(s) reach MIN_RATERS (${MIN_RATERS})`);

  // Feed: other people, followed by the demo account, with recent posts.
  const followees = plan.follows.filter(([f]) => f === DEMO_HANDLE).map(([, t]) => t);
  assert.ok(followees.length >= 3, `the demo account follows ${followees.length} people`);
  const recent = plan.people
    .filter((p) => followees.includes(p.handle))
    .flatMap((p) => p.rankings)
    .filter((r) => r.daysAgo <= 1);
  assert.ok(recent.length >= 5, `only ${recent.length} posts from the last day`);

  // Profile: a streak that is not zero.
  assert.ok(plan.summary.demoStreakDays >= 2, `streak would be ${plan.summary.demoStreakDays}`);
});

test("every person ranked today, so the streak touch_streak leaves behind is correct", () => {
  for (const p of buildPlan(NOW).people) {
    const last = p.rankings[p.rankings.length - 1];
    assert.ok(last, `${p.handle} ranks nothing`);
    assert.equal(last.daysAgo, 0, `${p.handle}'s last ranking is ${last.daysAgo} day(s) ago`);
  }
});

test("timestamps are in the past, ordered, and inside their day", () => {
  const plan = buildPlan(NOW);
  for (const p of plan.people) {
    let previous = 0;
    for (const r of p.rankings) {
      assert.ok(r.at.getTime() < NOW.getTime(), `${p.handle}/${r.bev.slug} is not in the past`);
      assert.ok(r.at.getTime() > previous, `${p.handle}/${r.bev.slug} is out of order`);
      previous = r.at.getTime();
      const daysBack = Math.floor((Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) - Date.UTC(r.at.getUTCFullYear(), r.at.getUTCMonth(), r.at.getUTCDate())) / 86_400_000);
      assert.equal(daysBack, r.daysAgo, `${p.handle}/${r.bev.slug} lands ${daysBack} day(s) back, planned ${r.daysAgo}`);
    }
  }
  for (const reaction of [...plan.likes, ...plan.comments]) {
    assert.ok(reaction.at.getTime() < NOW.getTime(), `a reaction by ${reaction.by} is not in the past`);
  }
});

test("alcohol is visible to the demo account (IS-3), and every person is over 21", () => {
  const plan = buildPlan(NOW);
  assert.ok(plan.summary.alcoholicBevs >= 2, `${plan.summary.alcoholicBevs} alcoholic Bev(s) in the plan`);
  const demo = plan.people.find((p) => p.handle === DEMO_HANDLE);
  assert.ok(demo?.rankings.some((r) => r.bev.isAlcoholic), "the demo account ranks no alcoholic Bev");
  for (const p of plan.people) {
    const years = (NOW.getTime() - new Date(`${p.birthDate}T00:00:00Z`).getTime()) / (365.25 * 86_400_000);
    assert.ok(years >= 21, `${p.handle} would be ${years.toFixed(1)}`);
  }
});

test("the bucket encoding is the database's 3/2/1", () => {
  assert.deepEqual(BUCKET_DB, { LOVED: 3, FINE: 2, DISLIKED: 1 });
});

test("a run on any day of the year still produces a usable plan", () => {
  // The day offsets are relative, so the only thing a different `now` can
  // break is the clamping of today's timestamps.
  for (const iso of ["2027-01-01T00:04:00Z", "2027-02-28T23:59:00Z", "2027-07-04T12:00:00Z"]) {
    const plan = buildPlan(new Date(iso));
    assert.ok(plan.summary.demoStreakDays >= 2, `${iso}: streak ${plan.summary.demoStreakDays}`);
    for (const p of plan.people) {
      let previous = 0;
      for (const r of p.rankings) {
        assert.ok(r.at.getTime() < new Date(iso).getTime(), `${iso}: ${p.handle}/${r.bev.slug} in the future`);
        assert.ok(r.at.getTime() > previous, `${iso}: ${p.handle}/${r.bev.slug} out of order`);
        previous = r.at.getTime();
      }
    }
  }
});

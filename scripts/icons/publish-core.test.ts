/**
 * Unit tests for scripts/icons/publish-core.ts -- the pure half of the icon
 * publish job.
 *
 *   npm run test:scripts
 *
 * node:test and node:assert, run with `--experimental-strip-types`, as in
 * scripts/venues/import-core.test.ts. Two things are deliberately pinned to
 * other files: the object path and the size limit to the migration
 * (20261112000200_bev_icons.sql), and the validation to the real manifest,
 * which must pass it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUCKET,
  MAX_ICON_BYTES,
  formatReport,
  iconObjectPath,
  isDuplicateUpload,
  svgSafetyProblems,
  toPublishRow,
  unpublished,
  validateManifest,
  type PublishReport,
} from "./publish-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20261112000200_bev_icons.sql");
const MANIFEST = join(ROOT, "design", "beverage-icons", "manifest.json");

const SHA = "bc21fe0c59931dc2ee6ba1b42099d67d042787756472a533ef9efed38fa330c1";
const SHA2 = "23bb0a7267c2b12690df526d86d71357da68d06ca6142a022356c992dd460cad";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bevId: "5ed1a9b6-46ac-5249-9bd6-2c0712bf631b",
    slug: "seven-up",
    styleVersion: "bevi-dimensional-v1",
    status: "needs-review",
    assets: { portableSvg: "portable-svg/seven-up.svg", portableSvgSha256: SHA },
    ...overrides,
  };
}

test("iconObjectPath is <slug>.<first 16 hex of sha256>.svg", () => {
  assert.equal(iconObjectPath("seven-up", SHA), "seven-up.bc21fe0c59931dc2.svg");
  assert.throws(() => iconObjectPath("Seven_Up", SHA), /kebab-case/);
  assert.throws(() => iconObjectPath("seven-up", SHA.toUpperCase()), /sha256/);
});

test("the path, bucket and size limit are the migration's", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.ok(sql.includes("check (path = slug || '.' || left(sha256, 16) || '.svg')"), "the table CHECK");
  assert.ok(sql.includes(`values ('${BUCKET}', '${BUCKET}', true, ${MAX_ICON_BYTES}, array['image/svg+xml'])`), "the bucket");
});

test("validateManifest accepts a good record and maps it to a publish row", () => {
  const [entry] = validateManifest({ records: [record()] });
  assert.deepEqual(entry, {
    bevId: "5ed1a9b6-46ac-5249-9bd6-2c0712bf631b",
    slug: "seven-up",
    styleVersion: "bevi-dimensional-v1",
    status: "needs-review",
    source: "portable-svg/seven-up.svg",
    sha256: SHA,
  });
  assert.deepEqual(toPublishRow(entry!), {
    bev_id: "5ed1a9b6-46ac-5249-9bd6-2c0712bf631b",
    slug: "seven-up",
    path: "seven-up.bc21fe0c59931dc2.svg",
    sha256: SHA,
    style_version: "bevi-dimensional-v1",
    status: "needs-review",
  });
});

test("validateManifest refuses what export-app.mjs refuses", () => {
  assert.throws(() => validateManifest({}), /no records array/);
  assert.throws(() => validateManifest({ records: [record({ bevId: "5ED1A9B6-46AC-5249-9BD6-2C0712BF631B" })] }), /lowercase UUID/);
  assert.throws(() => validateManifest({ records: [record({ slug: "Seven Up" })] }), /kebab-case/);
  assert.throws(
    () => validateManifest({ records: [record(), record({ slug: "seven-up-2" })] }),
    /duplicate bevId/,
  );
  assert.throws(
    () => validateManifest({ records: [record(), record({ bevId: "00000000-0000-4000-8000-000000000001" })] }),
    /duplicate slug/,
  );
  assert.throws(
    () => validateManifest({ records: [record({ assets: { portableSvg: "portable-svg/seven-up.svg", portableSvgSha256: "abc" } })] }),
    /not a sha256/,
  );
  assert.throws(() => validateManifest({ records: [record({ assets: { portableSvgSha256: SHA } })] }), /portableSvg is missing/);
  assert.throws(
    () => validateManifest({ records: [record({ assets: { portableSvg: "../../etc/passwd", portableSvgSha256: SHA } })] }),
    /outside design\/beverage-icons/,
  );
  assert.throws(() => validateManifest({ records: [record({ styleVersion: "" })] }), /styleVersion/);
  assert.throws(() => validateManifest({ records: [record({ status: undefined })] }), /status/);
});

test("the real manifest passes validation, and its rows are unique by path", () => {
  const entries = validateManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));
  assert.ok(entries.length > 0);
  const rows = entries.map(toPublishRow);
  assert.equal(new Set(rows.map((r) => r.path)).size, rows.length);
});

test("unpublished keeps rows whose path is not yet in the table, once each", () => {
  const a = toPublishRow(validateManifest({ records: [record()] })[0]!);
  const b = { ...a, bev_id: "00000000-0000-4000-8000-000000000002", slug: "fresca", path: iconObjectPath("fresca", SHA2), sha256: SHA2 };
  assert.deepEqual(unpublished([a, b], [a.path]), [b]);
  assert.deepEqual(unpublished([a, b], []), [a, b]);
  assert.deepEqual(unpublished([a, b], [a.path, b.path]), []);
  assert.deepEqual(unpublished([a, { ...a, bev_id: "00000000-0000-4000-8000-000000000003" }], []), [a]);
});

test("svgSafetyProblems passes a plain icon, gradients and #id references included", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
    '<path d="M0 0h64v64H0z" fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>';
  assert.deepEqual(svgSafetyProblems(svg), []);
});

test("svgSafetyProblems refuses script, event attributes, foreignObject and external links", () => {
  const wrap = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  assert.match(svgSafetyProblems(wrap("<script>alert(1)</script>")).join(), /<script>/);
  assert.match(svgSafetyProblems(wrap("<SCRIPT >alert(1)</SCRIPT>")).join(), /<script>/);
  assert.match(svgSafetyProblems('<svg onload="alert(1)"></svg>').join(), /onload=/);
  assert.match(svgSafetyProblems(wrap("<rect ONCLICK='x()'/>")).join(), /onclick=/);
  assert.match(svgSafetyProblems(wrap("<foreignObject><div/></foreignObject>")).join(), /foreignObject/);
  assert.match(svgSafetyProblems(wrap('<a href="javascript:alert(1)"><path/></a>')).join(), /not a #id/);
  assert.match(svgSafetyProblems(wrap('<image xlink:href="https://example.com/x.png"/>')).join(), /not a #id/);
  assert.match(svgSafetyProblems(wrap('<use href="other.svg#g"/>')).join(), /not a #id/);
  assert.match(svgSafetyProblems(wrap('<use href="data:image/svg+xml,abc"/>')).join(), /not a #id/);
  assert.match(svgSafetyProblems(wrap('<set attributeName="href" to="javascript:alert(1)"/>')).join(), /rewrite a link/);
  // An attribute value containing `>` does not end the tag early.
  assert.match(svgSafetyProblems(wrap('<rect title="a > b" onmouseover="x()"/>')).join(), /onmouseover=/);
});

test("isDuplicateUpload recognises both shapes of 'already exists'", () => {
  assert.equal(isDuplicateUpload(409, null), true);
  assert.equal(isDuplicateUpload(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" }), true);
  assert.equal(isDuplicateUpload(400, { error: "Duplicate" }), true);
  assert.equal(isDuplicateUpload(400, { statusCode: "415", error: "invalid_mime_type" }), false);
  assert.equal(isDuplicateUpload(403, { statusCode: "403", error: "Unauthorized" }), false);
  assert.equal(isDuplicateUpload(500, "oops"), false);
});

test("formatReport prints counts, then the ids behind each list", () => {
  const report: PublishReport = {
    received: 254,
    inserted: 250,
    updated: 1,
    unchanged: 0,
    deleted: 2,
    skipped_missing: ["00000000-0000-4000-8000-000000000001"],
    followed_merge: [{ from: "00000000-0000-4000-8000-000000000002", to: "00000000-0000-4000-8000-000000000003" }],
    dropped_duplicate: [],
    inactive: [],
    active_bevs: 400,
    active_with_icon: 251,
    active_without_photo_or_icon: 120,
  };
  assert.deepEqual(formatReport(report), [
    "publish_bev_icons: 254 received; 250 inserted, 1 updated, 0 unchanged, 2 deleted",
    "  skipped (no such Bev here): 1",
    "    00000000-0000-4000-8000-000000000001",
    "  followed a merge: 1",
    "    00000000-0000-4000-8000-000000000002 -> 00000000-0000-4000-8000-000000000003",
    "  dropped as a duplicate after merge resolution: 0",
    "  icon on a Bev that is not active: 0",
    "  live catalog: 400 active Bevs; 251 with an icon; 120 with neither a photo nor an icon",
  ]);
});

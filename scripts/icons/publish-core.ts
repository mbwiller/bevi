/**
 * The pure half of the icon publish job (scripts/icons/publish.ts). No I/O, no
 * fetch, no environment: everything here is a function of its arguments, so it
 * is unit tested in publish-core.test.ts and publish.ts keeps only the disk,
 * Storage and PostgREST.
 *
 * Conventions follow scripts/venues/import-core.ts: no dependencies, Node 22
 * type stripping, and the impure shell stays as thin as it can be.
 *
 * THE RULES MIRROR scripts/icons/export-app.mjs, which still ships the same
 * icons into the app bundle: a lowercase uuid bevId, a kebab-case slug, a
 * 64-hex portableSvgSha256, a portableSvg path inside design/beverage-icons/,
 * no duplicate bevId and no duplicate slug. A manifest one script accepts and
 * the other refuses would let the app and the backend disagree about an icon.
 */

import { posix } from "node:path";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA256 = /^[0-9a-f]{64}$/;

/** The bucket 20261112000200_bev_icons.sql creates. */
export const BUCKET = "bev-icons";

/**
 * The bucket's `file_size_limit` in 20261112000200 (512 KiB). An SVG over it
 * would be refused by Storage mid-run; the shell refuses it before uploading
 * anything. publish-core.test.ts pins this to the migration.
 */
export const MAX_ICON_BYTES = 524_288;

/**
 * One year, as storage-js sends it: `cacheControl: '31536000'` becomes the
 * header `cache-control: max-age=31536000` (StorageFileApi.uploadOrUpdate).
 * Safe because an object's key carries its content hash and is never
 * overwritten.
 */
export const CACHE_SECONDS = 31_536_000;

/** A validated manifest record: what the shell needs to read the SVG and publish it. */
export interface IconEntry {
  bevId: string;
  slug: string;
  styleVersion: string;
  status: string;
  /** assets.portableSvg, relative to design/beverage-icons/ (normalised, never escaping it). */
  source: string;
  /** assets.portableSvgSha256 as the manifest records it. */
  sha256: string;
}

/** One element of `publish_bev_icons`' p_rows (snake_case, as the RPC reads it). */
export interface PublishRow {
  bev_id: string;
  slug: string;
  path: string;
  sha256: string;
  style_version: string;
  status: string;
}

/**
 * The object key of an icon in the bucket: `<slug>.<first 16 hex of sha256>.svg`,
 * at the root. The same expression is the `bev_icons` CHECK.
 */
export function iconObjectPath(slug: string, sha256: string): string {
  if (!SLUG.test(slug)) throw new Error(`slug ${JSON.stringify(slug)} is not kebab-case`);
  if (!SHA256.test(sha256)) throw new Error(`sha256 ${JSON.stringify(sha256)} is not 64 lowercase hex`);
  return `${slug}.${sha256.slice(0, 16)}.svg`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates manifest.json's parsed contents and returns one entry per record,
 * in manifest order. Throws on the first problem, naming the record, exactly
 * as export-app.mjs does (it exits on the first `fail`).
 */
export function validateManifest(manifest: unknown): IconEntry[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.records)) {
    throw new Error("manifest has no records array");
  }
  const entries: IconEntry[] = [];
  const seenIds = new Map<string, string>();
  const seenSlugs = new Map<string, string>();
  for (const [i, raw] of (manifest.records as unknown[]).entries()) {
    const r = isRecord(raw) ? raw : {};
    const where = `record ${i} (${typeof r.slug === "string" ? r.slug : "no slug"})`;
    const { bevId, slug, styleVersion, status } = r;
    if (typeof bevId !== "string" || !UUID.test(bevId)) {
      throw new Error(`${where}: bevId ${JSON.stringify(bevId)} is not a lowercase UUID`);
    }
    if (typeof slug !== "string" || !SLUG.test(slug)) {
      throw new Error(`${where}: slug ${JSON.stringify(slug)} is not kebab-case`);
    }
    if (seenIds.has(bevId)) throw new Error(`duplicate bevId ${bevId} in ${seenIds.get(bevId)} and ${slug}`);
    if (seenSlugs.has(slug)) throw new Error(`duplicate slug ${slug} (bevIds ${seenSlugs.get(slug)} and ${bevId})`);
    seenIds.set(bevId, slug);
    seenSlugs.set(slug, bevId);

    if (typeof styleVersion !== "string" || styleVersion.trim() === "") {
      throw new Error(`${where}: styleVersion is missing`);
    }
    if (typeof status !== "string" || status.trim() === "") {
      throw new Error(`${where}: status is missing`);
    }

    const assets = isRecord(r.assets) ? r.assets : {};
    const source = assets.portableSvg;
    const sha256 = assets.portableSvgSha256;
    if (typeof source !== "string" || source === "") throw new Error(`${where}: assets.portableSvg is missing`);
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
      throw new Error(`${where}: assets.portableSvgSha256 is missing or not a sha256`);
    }
    const normalised = posix.normalize(source);
    if (posix.isAbsolute(normalised) || normalised === ".." || normalised.startsWith("../")) {
      throw new Error(`${where}: ${source} points outside design/beverage-icons`);
    }
    entries.push({ bevId, slug, styleVersion, status, source: normalised, sha256 });
  }
  return entries;
}

/** The RPC payload row for one entry. */
export function toPublishRow(entry: IconEntry): PublishRow {
  return {
    bev_id: entry.bevId,
    slug: entry.slug,
    path: iconObjectPath(entry.slug, entry.sha256),
    sha256: entry.sha256,
    style_version: entry.styleVersion,
    status: entry.status,
  };
}

/**
 * The rows whose object still has to be uploaded: those whose path is not
 * among the paths `bev_icons` already holds. One per distinct path, in the
 * order given. A path in the table was uploaded before its row was written
 * (publish.ts uploads first), so it is known to exist.
 */
export function unpublished(rows: readonly PublishRow[], published: Iterable<string>): PublishRow[] {
  const have = new Set(published);
  const out: PublishRow[] = [];
  for (const row of rows) {
    if (have.has(row.path)) continue;
    have.add(row.path);
    out.push(row);
  }
  return out;
}

/**
 * Why an SVG must not be served from our storage origin, or [] when it may.
 *
 * A public bucket serves the file at a URL on our Supabase origin. Rendered
 * through <img>, an SVG cannot run script or load anything; opened directly
 * (someone follows the URL) it is a document and can. So the job refuses
 * every way an SVG can carry behaviour or reach out:
 *   * a <script> element;
 *   * an on* event attribute (onload=, onclick=, ...);
 *   * a <foreignObject> (embeds HTML);
 *   * an href / xlink:href that is not a same-document `#id` reference
 *     (javascript:, data:, http(s): and relative URLs alike);
 *   * an <animate>/<set> whose attributeName targets href, the known way to
 *     swap a safe `#id` link for a javascript: one after load.
 * Tags are matched case-insensitively. The authored portable SVGs are plain
 * paths and gradients, so none of these should ever appear; this is the
 * guard for the day one does.
 */
export function svgSafetyProblems(svg: string): string[] {
  const problems = new Set<string>();
  if (/<script[\s>/]/i.test(svg)) problems.add("contains a <script> element");
  if (/<foreignObject[\s>/]/i.test(svg)) problems.add("contains a <foreignObject> element");

  const tag = /<([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attr = /([^\s=/>"']+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/g;
  for (const t of svg.matchAll(tag)) {
    const element = t[1]!.toLowerCase();
    const attrs = t[2] ?? "";
    for (const a of attrs.matchAll(attr)) {
      const name = a[1]!.toLowerCase();
      const value = (a[3] ?? a[4] ?? a[5] ?? "").trim();
      if (/^on[a-z]/.test(name)) problems.add(`has an event attribute ${name}= on <${element}>`);
      if ((name === "href" || name === "xlink:href") && !/^#[^\s]+$/.test(value)) {
        problems.add(`has ${name}="${value.slice(0, 40)}" on <${element}>, which is not a #id reference`);
      }
      if ((element === "animate" || element === "set") && name === "attributename" && /href/i.test(value)) {
        problems.add(`has <${element} attributeName="${value}">, which can rewrite a link`);
      }
    }
  }
  return [...problems];
}

/**
 * Whether a failed upload means "that key is already there". Content-addressed
 * keys make that a success: the bytes behind the key are the bytes we hold.
 *
 * The Storage API answers this as HTTP 409, or -- as packages/api/src/errors.ts
 * notes for most of its failures -- as HTTP 400 with the real status in the
 * JSON body's `statusCode` ('409') and `error: 'Duplicate'`. storage-js
 * (StorageApiError) reads exactly those fields; so does this.
 */
export function isDuplicateUpload(status: number, body: unknown): boolean {
  if (status === 409) return true;
  if (!isRecord(body)) return false;
  return String(body.statusCode ?? "") === "409" || body.error === "Duplicate";
}

/** `publish_bev_icons`' return value (20261112000200 section 4). */
export interface PublishReport {
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  skipped_missing: string[];
  followed_merge: { from: string; to: string }[];
  dropped_duplicate: string[];
  inactive: string[];
  active_bevs: number;
  active_with_icon: number;
  active_without_photo_or_icon: number;
}

/**
 * The report as log lines. Counts first; then the ids behind each non-empty
 * list (catalog Bev ids are uuidv5 of a public slug, so the repo already
 * names them; a user-created Bev's id is a random uuid that says nothing).
 */
export function formatReport(r: PublishReport): string[] {
  const lines = [
    `publish_bev_icons: ${r.received} received; ${r.inserted} inserted, ${r.updated} updated, ` +
      `${r.unchanged} unchanged, ${r.deleted} deleted`,
    `  skipped (no such Bev here): ${r.skipped_missing.length}`,
    ...r.skipped_missing.map((id) => `    ${id}`),
    `  followed a merge: ${r.followed_merge.length}`,
    ...r.followed_merge.map((m) => `    ${m.from} -> ${m.to}`),
    `  dropped as a duplicate after merge resolution: ${r.dropped_duplicate.length}`,
    ...r.dropped_duplicate.map((id) => `    ${id}`),
    `  icon on a Bev that is not active: ${r.inactive.length}`,
    ...r.inactive.map((id) => `    ${id}`),
    `  live catalog: ${r.active_bevs} active Bevs; ${r.active_with_icon} with an icon; ` +
      `${r.active_without_photo_or_icon} with neither a photo nor an icon`,
  ];
  return lines;
}

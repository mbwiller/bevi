// The pure half of the icon swipe tool (`npm run icons:swipe`): how a manifest
// and the reviewers' verdict files become three piles, and how one swipe
// changes a verdict file. No I/O here; scripts/icons/swipe.ts does the reading,
// the writing and the HTTP.
//
// Model. Each reviewer owns one file, design/beverage-icons/verdicts/<name>.json,
// so two people sorting on two Macs never produce a git conflict. The piles are
// shared: an icon's verdict is the newest entry any reviewer wrote for it. A
// verdict is about one piece of art, recorded as the first 16 hex digits of the
// portable SVG's SHA-256 (the same digest the published object is named by), so
// an icon that is redrawn goes back to the unsorted pile on its own.

export const REVIEWERS = ['matt', 'arjun'] as const;
export type Reviewer = (typeof REVIEWERS)[number];
export type Verdict = 'good' | 'needs-work';
export type Pile = Verdict | 'unsorted';

export const NOTE_MAX = 500;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ART = /^[0-9a-f]{16}$/;

/** One reviewer's decision on one icon. `unsorted` is a deliberate "back to the deck". */
export interface Entry { verdict: Pile; at: string; art: string; note?: string }
export type VerdictFiles = Partial<Record<Reviewer, Record<string, Entry>>>;

export interface ManifestRecord {
  slug: string; name: string; brand: string; family: string; isStarter: boolean;
  packageChoice?: unknown; uncertainty?: unknown;
  /** The recipe file that draws the icon, e.g. scripts/icons/families/colas.mjs. */
  sourceModule?: string;
  references?: { pageUrl?: unknown }[];
  assets: { portableSvg: string; portableSvgSha256: string };
}

export interface DeckIcon {
  slug: string; name: string; brand: string; family: string; isStarter: boolean;
  art: string; packageChoice: string; uncertainty: string; references: string[];
  pile: Pile;
  /** Who put it in its pile, when, and their note. Absent on a never-sorted icon. */
  by?: Reviewer; at?: string; note?: string;
  /** Set when the art changed after the last verdict: what that verdict was. */
  previous?: { verdict: Verdict; by: Reviewer; at: string; note?: string };
}
export interface Deck { icons: DeckIcon[]; counts: Record<Pile, number>; reviewers: readonly Reviewer[] }

export function isReviewer(value: unknown): value is Reviewer {
  return typeof value === 'string' && (REVIEWERS as readonly string[]).includes(value);
}
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG.test(value);
}
export function artOf(record: ManifestRecord): string {
  return record.assets.portableSvgSha256.slice(0, 16);
}

/** The manifest's records, keeping only those the tool can show. Throws on a manifest it cannot read. */
export function parseManifest(text: string): ManifestRecord[] {
  const manifest = JSON.parse(text) as { records?: unknown };
  if (!Array.isArray(manifest.records)) throw new Error('manifest.json has no records array');
  return (manifest.records as ManifestRecord[]).filter(r =>
    r && isSlug(r.slug) && typeof r.name === 'string' && r.assets
    && typeof r.assets.portableSvg === 'string' && typeof r.assets.portableSvgSha256 === 'string'
    && ART.test(r.assets.portableSvgSha256.slice(0, 16)));
}

function parseEntry(value: unknown): Entry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { verdict, at, art, note } = value as Record<string, unknown>;
  if (verdict !== 'good' && verdict !== 'needs-work' && verdict !== 'unsorted') return undefined;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return undefined;
  if (typeof art !== 'string' || !ART.test(art)) return undefined;
  const entry: Entry = { verdict, at, art };
  if (typeof note === 'string' && note.trim()) entry.note = note.trim().slice(0, NOTE_MAX);
  return entry;
}

/** A verdict file's entries. A hand-edited or half-merged entry is dropped, never guessed at. */
export function parseVerdictFile(text: string): Record<string, Entry> {
  const file = JSON.parse(text) as { verdicts?: unknown };
  const entries: Record<string, Entry> = {};
  if (!file.verdicts || typeof file.verdicts !== 'object') return entries;
  for (const [slug, value] of Object.entries(file.verdicts)) {
    const entry = parseEntry(value);
    if (entry && isSlug(slug)) entries[slug] = entry;
  }
  return entries;
}

/** One icon per line, slugs sorted: a swipe is a one-line diff and the file greps well. */
export function serializeVerdictFile(reviewer: Reviewer, entries: Record<string, Entry>): string {
  const lines = Object.keys(entries).sort().map(slug => {
    const { verdict, at, art, note } = entries[slug];
    return `    ${JSON.stringify(slug)}: ${JSON.stringify(note ? { verdict, at, art, note } : { verdict, at, art })}`;
  });
  return `{\n  "reviewer": ${JSON.stringify(reviewer)},\n  "verdicts": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}\n}\n`;
}

function newest(files: VerdictFiles, slug: string): { by: Reviewer; entry: Entry } | undefined {
  let found: { by: Reviewer; entry: Entry } | undefined;
  for (const by of REVIEWERS) {
    const entry = files[by]?.[slug];
    if (entry && (!found || Date.parse(entry.at) > Date.parse(found.entry.at))) found = { by, entry };
  }
  return found;
}

const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

/**
 * The three piles. Unsorted comes first and, within it, redrawn icons lead: they
 * are answers to an earlier "needs work" and the quickest to judge. Everything
 * else keeps the manifest's order, so a new icon joins the deck where the build put it.
 */
export function buildDeck(records: ManifestRecord[], files: VerdictFiles): Deck {
  const counts: Record<Pile, number> = { unsorted: 0, good: 0, 'needs-work': 0 };
  const icons = records.map((record): DeckIcon => {
    const icon: DeckIcon = {
      slug: record.slug, name: record.name, brand: text(record.brand), family: text(record.family),
      isStarter: record.isStarter === true, art: artOf(record),
      packageChoice: text(record.packageChoice), uncertainty: text(record.uncertainty),
      references: (record.references ?? []).map(r => r?.pageUrl).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
      pile: 'unsorted',
    };
    const last = newest(files, record.slug);
    if (last && last.entry.verdict !== 'unsorted') {
      const { verdict, at, note } = last.entry;
      if (last.entry.art === icon.art) Object.assign(icon, { pile: verdict, by: last.by, at }, note ? { note } : {});
      else icon.previous = { verdict, by: last.by, at, ...(note ? { note } : {}) };
    }
    counts[icon.pile]++;
    return icon;
  });
  const rank = (icon: DeckIcon) => icon.pile !== 'unsorted' ? 2 : icon.previous ? 0 : 1;
  return { icons: icons.map((icon, i) => ({ icon, i })).sort((a, b) => rank(a.icon) - rank(b.icon) || a.i - b.i).map(x => x.icon), counts, reviewers: REVIEWERS };
}

export interface Swipe { slug: string; verdict: Pile; reviewer: Reviewer; art: string; note?: string }

/** A request body as a Swipe, or the reason it is not one. Nothing from the body is trusted. */
export function parseSwipe(body: unknown): Swipe | string {
  if (!body || typeof body !== 'object') return 'expected a JSON object';
  const { slug, verdict, reviewer, art, note } = body as Record<string, unknown>;
  if (!isSlug(slug)) return 'slug is not an icon slug';
  if (verdict !== 'good' && verdict !== 'needs-work' && verdict !== 'unsorted') return 'verdict must be good, needs-work or unsorted';
  if (!isReviewer(reviewer)) return `reviewer must be one of ${REVIEWERS.join(', ')}`;
  if (typeof art !== 'string' || !ART.test(art)) return 'art must be the 16-hex digest the deck sent';
  if (note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX)) return `note must be text of at most ${NOTE_MAX} characters`;
  const swipe: Swipe = { slug, verdict, reviewer, art };
  if (typeof note === 'string' && note.trim()) swipe.note = note.trim();
  return swipe;
}

/**
 * The reviewer's entries after a swipe. Sending an icon back to the deck removes
 * the reviewer's own entry when nobody else has judged it (an undo leaves no
 * trace), and otherwise records `unsorted` so it outranks the other reviewer's
 * older verdict. `now` must be later than every existing entry for the slug, or
 * the swipe would lose to a clock that runs ahead; it is nudged past them.
 */
export function applySwipe(files: VerdictFiles, swipe: Swipe, now: Date): Record<string, Entry> {
  const mine = { ...(files[swipe.reviewer] ?? {}) };
  const others = REVIEWERS.filter(r => r !== swipe.reviewer).some(r => files[r]?.[swipe.slug]);
  if (swipe.verdict === 'unsorted' && !others) { delete mine[swipe.slug]; return mine; }
  const last = newest(files, swipe.slug);
  const at = new Date(Math.max(now.getTime(), last ? Date.parse(last.entry.at) + 1 : 0)).toISOString();
  mine[swipe.slug] = { verdict: swipe.verdict, at, art: swipe.art, ...(swipe.note && swipe.verdict !== 'unsorted' ? { note: swipe.note } : {}) };
  return mine;
}

// ---- Who may talk to the server -------------------------------------------
// The server listens on the local network so a phone can reach it, and it has
// one write endpoint. Two checks keep it a tool for people on that network: the
// peer must be on a private or loopback address, and the Host header must be an
// address or a local name, which is what stops a public web page from reaching
// it through DNS rebinding.

export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase().replace(/^::ffff:/, '').replace(/%.*$/, '');
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])];
    return p === 127 || p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)
      || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

/** `host` is the Host header; `names` are this machine's own names, lower-cased. */
export function isAllowedHost(host: string | undefined, port: number, names: readonly string[]): boolean {
  if (!host) return false;
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d+))?$/.exec(host.toLowerCase());
  if (!match || Number(match[2] ?? 80) !== port) return false;
  const name = match[1];
  if (name.startsWith('[')) return isPrivateAddress(name.slice(1, -1));
  if (/^[\d.]+$/.test(name)) return isPrivateAddress(name);
  return name === 'localhost' || names.includes(name);
}

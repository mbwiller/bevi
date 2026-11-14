// Redaction and input shaping for the bug-report function. Pure: no Deno
// APIs, no network, so test.ts can exercise all of it without a server.
//
// Two jobs, and they are not the same job:
//   * `redact()` removes what must never leave the device inside a ticket --
//     tokens, keys, cookies, emails, anything shaped like a credential. It runs
//     on every string that reaches Linear, including the ones the reporter
//     typed, because a tester pasting an error message is exactly how a token
//     ends up in a ticket.
//   * `neutralise()` stops ticket text from being read as markdown structure,
//     or as instructions, by whatever renders or consumes it later -- a coding
//     agent included. Ticket text is data. See AGENTS.md.

/** Caps, enforced here and not only by the client. */
export const LIMITS = {
  title: 160,
  description: 4000,
  step: 300,
  steps: 12,
  envValue: 120,
  idempotencyKey: 100,
  evidence: 3,
} as const;

/** Caps for the breadcrumb trail the app sends (docs/bug-workflow.md). */
export const BREADCRUMB_LIMITS = {
  /** The most recent entries are kept when the client sends more. */
  count: 40,
  at: 40,
  route: 120,
  /** `tap`: what was tapped, e.g. 'TabBar › Add Bev'. */
  target: 120,
  /** `error`: the error's message. */
  message: 200,
  method: 60,
  code: 40,
  statusMin: 100,
  statusMax: 599,
  msMax: 600_000,
} as const;

export const REDACTED = "[redacted]";

// ORDER MATTERS, and not only for tidiness. The generic `key: value` pattern
// stops at the first whitespace, so on `Authorization: Bearer abc...` it would
// redact `Authorization: Bearer` and leave the token itself sitting in the
// ticket. Every pattern that knows the *shape* of a credential therefore runs
// first; the generic assignment pattern mops up what is left (including the
// `[redacted]` the earlier pass wrote, which is harmless).
const PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // JWTs, on their own.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Supabase, Linear, GitHub, Stripe, Slack and AWS key shapes.
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g,
  /\blin_(?:api|oauth)_[A-Za-z0-9]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Any URL carrying a credential in its query string or fragment.
  /\bhttps?:\/\/\S*?[?&#](?:access_token|refresh_token|token|code|api[_-]?key|apikey|key|signature|sig|password)=\S*/gi,
  // A URL with inline credentials (https://user:pass@host).
  /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@\S+/gi,
  // Anything spelled like a secret assignment, including the headers above.
  /\b(?:authorization|cookie|set-cookie|x-api-key|apikey|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd|private[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
  // Email addresses: a reporter's own, or another user's, is PII we do not need.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

// Control characters other than tab and newline, plus zero-width and bidi
// marks, which can make a ticket render differently from what it says.
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Strips credentials, PII and invisible characters from one string. */
export function redact(value: string): string {
  let out = value.replace(INVISIBLE, "");
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Makes a redacted string safe to drop into the issue body: no fence that
 * could close the block it sits in, no heading or rule that could restructure
 * the document a reader (or an agent) is parsing.
 */
export function neutralise(value: string): string {
  return value
    .replace(/```/g, "'''")
    .replace(/^(\s*)(#{1,6}\s)/gm, "$1\\$2")
    .replace(/^(\s*)(-{3,}|={3,})\s*$/gm, "$1\\$2");
}

/** Collapses whitespace, redacts, neutralises and caps. Returns '' for anything unusable. */
export function clean(value: unknown, max: number, { singleLine = false }: { singleLine?: boolean } = {}): string {
  if (typeof value !== "string") return "";
  let out = value.replace(/\r\n?/g, "\n");
  if (singleLine) out = out.replace(/\s+/g, " ");
  out = neutralise(redact(out)).trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** The reproduction steps: at most `LIMITS.steps`, each cleaned, empties dropped. */
export function cleanSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const step of value) {
    const text = clean(step, LIMITS.step, { singleLine: true });
    if (text) out.push(text);
    if (out.length === LIMITS.steps) break;
  }
  return out;
}

/** The environment block the client sends. Every value is optional and every value is cleaned. */
export interface Environment {
  route?: string;
  component?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  /** The deploy's git SHA, as the build inlined it. */
  build?: string;
  stage?: string;
  /** 'light' | 'dark', as the app rendered it. */
  theme?: string;
  /** 'online' | 'offline' at the moment the form opened. */
  online?: string;
  viewport?: string;
  occurredAt?: string;
  reproducibility?: string;
  /** The concrete path, e.g. '/bev/8f3a…'. Dropped if it carries a query string or a fragment. */
  path?: string;
  /** 'home screen' | 'browser'. */
  display?: string;
  /** The contract sends a number; the ticket prints it. */
  pixelRatio?: string;
  /** 'top,right,bottom,left' in CSS px. */
  safeArea?: string;
  /** The contract sends a boolean; the ticket prints 'yes' or 'no'. */
  reducedMotion?: string;
}

/** The keys that may appear in the ticket, in the order the template prints them. */
export const ENVIRONMENT_KEYS: readonly (keyof Environment)[] = [
  "route",
  "component",
  "platform",
  "osVersion",
  "appVersion",
  "build",
  "stage",
  "theme",
  "online",
  "viewport",
  "occurredAt",
  "reproducibility",
  "path",
  "display",
  "pixelRatio",
  "safeArea",
  "reducedMotion",
];

/** The label each environment key prints under in the ticket. */
export const ENVIRONMENT_LABELS: Record<keyof Environment, string> = {
  route: "Screen/route",
  component: "Component",
  platform: "Platform",
  osVersion: "OS",
  appVersion: "App version",
  build: "Build",
  stage: "Environment",
  theme: "Theme",
  online: "Connectivity",
  viewport: "Viewport",
  occurredAt: "Timestamp",
  reproducibility: "Reproducibility",
  path: "Path",
  display: "Opened as",
  pixelRatio: "Pixel ratio",
  safeArea: "Safe area (t,r,b,l)",
  reducedMotion: "Reduced motion",
};

/** The typed values the contract sends as something other than a string, as the word the ticket prints. */
function environmentValue(key: keyof Environment, value: unknown): unknown {
  if (key === "online" && typeof value === "boolean") return value ? "online" : "offline";
  if (key === "reducedMotion" && typeof value === "boolean") return value ? "yes" : "no";
  if (key === "pixelRatio") return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
  return value;
}

/**
 * Keeps only the known keys, cleans every value, and drops everything else the
 * client sent. An extra field a future client invents cannot reach the ticket
 * until this list names it -- which is the point: diagnostics are an allow-list,
 * never a passthrough of whatever the device had lying around.
 */
export function cleanEnvironment(value: unknown): Environment {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out: Environment = {};
  for (const key of ENVIRONMENT_KEYS) {
    const text = clean(environmentValue(key, source[key]), LIMITS.envValue, { singleLine: true });
    if (!text) continue;
    // The path is the one value that is a real URL piece, so it is the one
    // that could carry a token: anything with a query string or a fragment, or
    // that is not an absolute path, is dropped rather than trimmed.
    if (key === "path" && (!text.startsWith("/") || /[?#]/.test(text))) continue;
    out[key] = text;
  }
  return out;
}

/**
 * One entry of the trail the app keeps: where the reporter went, what they
 * tapped, which API calls failed and which errors went uncaught, in the
 * minutes before the report (docs/bug-workflow.md). Never arguments, never
 * responses, never anything typed: a route pattern, a component and its
 * label, a method name, an error code, a status, a duration, an error message.
 */
export interface Breadcrumb {
  at: string;
  kind: "nav" | "api" | "tap" | "error";
  /** `tap` only. */
  target?: string;
  /** `error` only. */
  message?: string;
  route?: string;
  method?: string;
  code?: string;
  status?: number;
  ms?: number;
}

const METHOD_RE = /^[A-Za-z][A-Za-z0-9.]*$/;

function integerIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= min && value <= max ? value : undefined;
}

const BREADCRUMB_KINDS: readonly Breadcrumb["kind"][] = ["nav", "api", "tap", "error"];

/**
 * The breadcrumb allow-list: at most `BREADCRUMB_LIMITS.count` entries (the
 * most recent when the client sends more), each with a known kind, a cleaned
 * timestamp, and only the fields the shape allows. A `nav` entry without a
 * route, an `api` entry without a method, a `tap` without a target or an
 * `error` without a message says nothing and is dropped.
 */
export function cleanBreadcrumbs(value: unknown): Breadcrumb[] {
  if (!Array.isArray(value)) return [];
  const recent = value.slice(-BREADCRUMB_LIMITS.count);
  const out: Breadcrumb[] = [];
  for (const entry of recent) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const kind = (BREADCRUMB_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as Breadcrumb["kind"]) : null;
    const at = clean(raw.at, BREADCRUMB_LIMITS.at, { singleLine: true });
    if (!kind || !at) continue;

    const crumb: Breadcrumb = { at, kind };
    if (kind === "tap") {
      const target = clean(raw.target, BREADCRUMB_LIMITS.target, { singleLine: true });
      if (target) crumb.target = target;
    }
    if (kind === "error") {
      const message = clean(raw.message, BREADCRUMB_LIMITS.message, { singleLine: true });
      if (message) crumb.message = message;
    }
    const route = clean(raw.route, BREADCRUMB_LIMITS.route, { singleLine: true });
    if (route) crumb.route = route;
    const method = typeof raw.method === "string" ? raw.method.trim() : "";
    if (method && METHOD_RE.test(method) && method.length <= BREADCRUMB_LIMITS.method) crumb.method = method;
    const code = clean(raw.code, BREADCRUMB_LIMITS.code, { singleLine: true });
    if (code) crumb.code = code;
    const status = integerIn(raw.status, BREADCRUMB_LIMITS.statusMin, BREADCRUMB_LIMITS.statusMax);
    if (status !== undefined) crumb.status = status;
    const ms = integerIn(raw.ms, 0, BREADCRUMB_LIMITS.msMax);
    if (ms !== undefined) crumb.ms = ms;

    if (kind === "nav" && !crumb.route) continue;
    if (kind === "api" && !crumb.method) continue;
    if (kind === "tap" && !crumb.target) continue;
    if (kind === "error" && !crumb.message) continue;
    out.push(crumb);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Targets: the components the reporter pointed at
// ---------------------------------------------------------------------------

/** Caps for the pointed-at components (`BugReportTarget` in @bevi/shared). */
export const TARGET_LIMITS = {
  count: 6,
  component: 60,
  pathNames: 8,
  file: 160,
  label: 160,
  role: 40,
  text: 160,
  route: 120,
  entries: 12,
  key: 40,
  value: 80,
  rectMin: -10_000,
  rectMax: 100_000,
  evidenceIndexMax: 2,
  markMin: 1,
  markMax: 9,
  caption: 120,
} as const;

/**
 * One component the reporter pointed at, cleaned. Every string went through
 * `clean()`; the names and the file are also held to a strict shape, because
 * they are printed inside backticks and are what an agent will search for.
 */
export interface Target {
  component: string;
  path?: string[];
  file?: string;
  label?: string;
  role?: string;
  text?: string;
  props?: Record<string, string | number | boolean>;
  styles?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  route?: string;
  evidenceIndex?: number;
  mark?: number;
}

/** A component name as source writes it: `TabBar`, `Bev.Card`. */
const COMPONENT_RE = /^[A-Za-z_$][\w$.]*$/;
/** A repo-relative source file under one of the three trees the app is built from. */
const FILE_RE = /^(app|packages|shared)\/[\w.\/()\[\]+@-]+\.(tsx?|jsx?)$/;
/** A prop or style key: an identifier. */
const KEY_RE = /^[A-Za-z_$][\w$]*$/;

function name(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // An identifier can still be shaped like a key (`sb_secret_…`); one that
  // redaction would touch is dropped rather than printed half-redacted.
  return text.length > 0 && text.length <= max && COMPONENT_RE.test(text) && redact(text) === text ? text : null;
}

/** The first `TARGET_LIMITS.entries` well-keyed entries of a plain object, values shaped by `keep`. */
function entries<T>(value: unknown, keep: (v: unknown) => T | undefined): Record<string, T> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, T> = {};
  let n = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (n === TARGET_LIMITS.entries) break;
    if (key.length > TARGET_LIMITS.key || !KEY_RE.test(key)) continue;
    const kept = keep(raw);
    if (kept === undefined) continue;
    out[key] = kept;
    n++;
  }
  return n ? out : undefined;
}

function finiteIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

function cleanTarget(value: unknown): Target | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const component = name(raw.component, TARGET_LIMITS.component);
  if (!component) return null;
  const out: Target = { component };

  if (Array.isArray(raw.path)) {
    const path = raw.path
      .slice(0, TARGET_LIMITS.pathNames)
      .map((n) => name(n, TARGET_LIMITS.component))
      .filter((n): n is string => n !== null);
    if (path.length) out.path = path;
  }

  if (typeof raw.file === "string") {
    const file = raw.file.trim();
    if (file.length <= TARGET_LIMITS.file && FILE_RE.test(file) && !file.includes("..") && redact(file) === file) out.file = file;
  }

  const label = clean(raw.label, TARGET_LIMITS.label, { singleLine: true });
  if (label) out.label = label;
  const role = clean(raw.role, TARGET_LIMITS.role, { singleLine: true });
  if (role) out.role = role;
  const text = clean(raw.text, TARGET_LIMITS.text, { singleLine: true });
  if (text) out.text = text;
  const route = clean(raw.route, TARGET_LIMITS.route, { singleLine: true });
  if (route) out.route = route;

  const props = entries<string | number | boolean>(raw.props, (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
    const s = clean(v, TARGET_LIMITS.value, { singleLine: true });
    return s ? s : undefined;
  });
  if (props) out.props = props;
  const styles = entries<string>(raw.styles, (v) => {
    const s = clean(v, TARGET_LIMITS.value, { singleLine: true });
    return s ? s : undefined;
  });
  if (styles) out.styles = styles;

  if (typeof raw.rect === "object" && raw.rect !== null) {
    const r = raw.rect as Record<string, unknown>;
    const x = finiteIn(r.x, TARGET_LIMITS.rectMin, TARGET_LIMITS.rectMax);
    const y = finiteIn(r.y, TARGET_LIMITS.rectMin, TARGET_LIMITS.rectMax);
    const width = finiteIn(r.width, TARGET_LIMITS.rectMin, TARGET_LIMITS.rectMax);
    const height = finiteIn(r.height, TARGET_LIMITS.rectMin, TARGET_LIMITS.rectMax);
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) out.rect = { x, y, width, height };
  }

  const evidenceIndex = integerIn(raw.evidenceIndex, 0, TARGET_LIMITS.evidenceIndexMax);
  if (evidenceIndex !== undefined) out.evidenceIndex = evidenceIndex;
  const mark = integerIn(raw.mark, TARGET_LIMITS.markMin, TARGET_LIMITS.markMax);
  if (mark !== undefined) out.mark = mark;
  return out;
}

/**
 * The target allow-list: the first `TARGET_LIMITS.count` entries the client
 * sent, each cleaned by `cleanTarget`. A target whose component name is not a
 * plain identifier is dropped whole; anything else the object carries that
 * this shape does not name never reaches the ticket.
 */
export function cleanTargets(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, TARGET_LIMITS.count)
    .map(cleanTarget)
    .filter((t): t is Target => t !== null);
}

/** One cleaned single-line caption per evidence path, '' where the client sent none. */
export function cleanCaptions(value: unknown, count: number): string[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, i) => clean(list[i], TARGET_LIMITS.caption, { singleLine: true }));
}

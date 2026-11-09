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
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}\u2026` : out;
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
  build?: string;
  stage?: string;
  viewport?: string;
  occurredAt?: string;
  reproducibility?: string;
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
  "viewport",
  "occurredAt",
  "reproducibility",
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
  viewport: "Viewport",
  occurredAt: "Timestamp",
  reproducibility: "Reproducibility",
};

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
    const text = clean(source[key], LIMITS.envValue, { singleLine: true });
    if (text) out[key] = text;
  }
  return out;
}

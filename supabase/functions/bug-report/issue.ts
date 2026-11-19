// Validates and cleans the report the app sends, and prints the parts of a
// ticket's write-up that are about the report itself (the pointed-at
// components, the recent activity lines); board.ts puts the write-up
// together. Pure, so test.ts can assert the exact text without a network or
// a Deno server.

import {
  type Breadcrumb,
  clean,
  cleanBreadcrumbs,
  cleanCaptions,
  cleanEnvironment,
  cleanSteps,
  cleanTargets,
  LIMITS,
  redact,
  type Environment,
  type Target,
} from "./redact.ts";

/** What the reporter said it is. Mirrors `BugReportKind` in @bevi/shared. */
export type Kind = "bug" | "fix" | "idea" | "design";
/** How bad the reporter said it is. Mirrors `BugReportSeverity` in @bevi/shared. */
export type Severity = "blocker" | "bad" | "annoying" | "polish";

export const KINDS: readonly Kind[] = ["bug", "fix", "idea", "design"];
export const SEVERITIES: readonly Severity[] = ["blocker", "bad", "annoying", "polish"];

/** The word each kind prints under on the write-up's Type line. */
export const KIND_LABELS: Record<Kind, string> = {
  bug: "Bug",
  fix: "Fix suggestion",
  idea: "Idea",
  design: "Design nit",
};

export interface RawReport {
  kind?: unknown;
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  reproductionSteps?: unknown;
  expected?: unknown;
  actual?: unknown;
  environment?: unknown;
  breadcrumbs?: unknown;
  targets?: unknown;
  stepsSource?: unknown;
  idempotencyKey?: unknown;
  evidencePaths?: unknown;
  evidenceCaptions?: unknown;
}

/** Who wrote the steps: the reporter, or the app from what it recorded. */
export type StepsSource = "typed" | "recorded";

export interface CleanReport {
  kind: Kind;
  severity: Severity;
  title: string;
  description: string;
  reproductionSteps: string[];
  expected: string;
  actual: string;
  environment: Environment;
  breadcrumbs: Breadcrumb[];
  targets: Target[];
  stepsSource: StepsSource;
  idempotencyKey: string;
  evidencePaths: string[];
  /** One per evidence path, in the same order; '' where the client sent none. */
  evidenceCaptions: string[];
}

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `<uid>/<random>.<ext>`, which is the only shape packages/api/src/bugs.ts
// writes. The storage policy enforces the uid half; this enforces the rest so
// a crafted path cannot send the function reading some other object.
const EVIDENCE_PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}\.(?:jpg|jpeg|png|webp)$/i;

/** Validates and cleans the request body. Throws `ValidationError` naming the field at fault. */
export function parseReport(raw: RawReport): CleanReport {
  const kind = typeof raw.kind === "string" && (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as Kind) : null;
  if (!kind) throw new ValidationError("kind", "kind must be one of bug, fix, idea, design");

  const severity =
    typeof raw.severity === "string" && (SEVERITIES as readonly string[]).includes(raw.severity) ? (raw.severity as Severity) : null;
  if (!severity) throw new ValidationError("severity", "severity must be one of blocker, bad, annoying, polish");

  const title = clean(raw.title, LIMITS.title, { singleLine: true });
  if (!title) throw new ValidationError("title", "A title is required");

  const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  // A UUID is what the client generates; requiring the shape keeps the key
  // from becoming a channel for arbitrary text into the ledger.
  if (!UUID_RE.test(idempotencyKey)) throw new ValidationError("idempotencyKey", "idempotencyKey must be a UUID");

  const evidencePaths: string[] = [];
  if (raw.evidencePaths !== undefined && raw.evidencePaths !== null) {
    if (!Array.isArray(raw.evidencePaths)) {
      throw new ValidationError("evidencePaths", "evidencePaths must be a list of bug-evidence object paths");
    }
    if (raw.evidencePaths.length > LIMITS.evidence) {
      throw new ValidationError("evidencePaths", `At most ${LIMITS.evidence} screenshots per report`);
    }
    for (const path of raw.evidencePaths) {
      if (typeof path !== "string" || !EVIDENCE_PATH_RE.test(path)) {
        throw new ValidationError("evidencePaths", "evidencePaths holds something that is not a bug-evidence object path");
      }
      evidencePaths.push(path);
    }
  }

  return {
    kind,
    severity,
    title,
    description: clean(raw.description, LIMITS.description),
    reproductionSteps: cleanSteps(raw.reproductionSteps),
    expected: clean(raw.expected, LIMITS.step),
    actual: clean(raw.actual, LIMITS.step),
    environment: cleanEnvironment(raw.environment),
    breadcrumbs: cleanBreadcrumbs(raw.breadcrumbs),
    targets: cleanTargets(raw.targets),
    // Only the exact word: anything else is the reporter's own account.
    stepsSource: raw.stepsSource === "recorded" ? "recorded" : "typed",
    idempotencyKey,
    evidencePaths,
    evidenceCaptions: cleanCaptions(raw.evidenceCaptions, evidencePaths.length),
  };
}

const NOTHING_POINTED_AT = "_Nothing was pointed at; the note is about the whole screen._";

/** What the second column of a crumb says: the route, the call, the tap or the error. */
function crumbSubject(crumb: Breadcrumb): string {
  switch (crumb.kind) {
    case "nav":
      return crumb.route ?? "";
    case "api":
      return crumb.method ?? "";
    case "tap":
      return crumb.target ?? "";
    case "error":
      return crumb.message ?? "";
  }
}

/** One line of the Recent activity block: when, what kind, where or which call, and how it ended. */
export function breadcrumbLine(crumb: Breadcrumb): string {
  const parts = [crumb.at, crumb.kind, crumbSubject(crumb)];
  if (crumb.code) parts.push(crumb.code);
  if (crumb.status !== undefined) parts.push(String(crumb.status));
  if (crumb.ms !== undefined) parts.push(`${crumb.ms} ms`);
  return parts.filter(Boolean).join("  ");
}

/** Backticks out, so a value cannot close the code span it is printed in. */
function code(value: string): string {
  return `\`${value.replace(/`/g, "")}\``;
}

/**
 * Whether a `key=value` pair passes redaction untouched. `cleanTargets` saw
 * the key and the value separately, so the `secret = value` patterns only
 * get to see them together here; a pair they would touch is dropped whole.
 */
function survivesRedaction(pair: string): boolean {
  return redact(pair) === pair;
}

function propValue(value: string | number | boolean): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * One pointed-at component as a numbered block: the name in a code span (it
 * is what an agent will search for), then only the lines that have data.
 */
export function targetBlock(target: Target, position: number): string {
  const number = target.mark ?? position;
  const caption = target.label ?? target.text;
  const lines = [`**${number}. ${code(target.component)}**${caption ? ` — ${caption}` : ""}`];
  if (target.file) lines.push(`- Source: ${code(target.file)}`);
  if (target.path?.length) lines.push(`- Inside: ${target.path.join(" › ")}`);
  if (target.role && target.label) lines.push(`- Role and label: ${target.role}, "${target.label}"`);
  else if (target.role) lines.push(`- Role: ${target.role}`);
  else if (target.label) lines.push(`- Label: "${target.label}"`);
  if (target.text) lines.push(`- Text: "${target.text}"`);
  if (target.props) {
    const props = Object.entries(target.props)
      .map(([k, v]) => `${k}=${propValue(v)}`)
      .filter(survivesRedaction)
      .map(code);
    if (props.length) lines.push(`- Props: ${props.join(", ")}`);
  }
  if (target.styles) {
    const styles = Object.entries(target.styles)
      .filter(([k, v]) => survivesRedaction(`${k}=${v}`))
      .map(([k, v]) => `${k} ${v}`);
    if (styles.length) lines.push(`- Drawn with: ${styles.join("; ")}`);
  }
  if (target.rect) {
    const { x, y, width, height } = target.rect;
    lines.push(`- On screen: ${width} × ${height} at (${x}, ${y})${target.route ? ` on ${target.route}` : ""}`);
  } else if (target.route) {
    lines.push(`- On screen: ${target.route}`);
  }
  const where = [
    target.evidenceIndex !== undefined ? `Screenshot ${target.evidenceIndex + 1}` : "",
    target.mark !== undefined ? `${target.evidenceIndex !== undefined ? "mark" : "Mark"} ${target.mark}` : "",
  ].filter(Boolean);
  if (where.length) lines.push(`- ${where.join(", ")}`);
  return lines.join("\n");
}

/** The Pointed at section's body. */
export function pointedAt(targets: Target[]): string {
  return targets.length ? targets.map((t, i) => targetBlock(t, i + 1)).join("\n\n") : NOTHING_POINTED_AT;
}

// The board half of the bug-report function: the founders' board
// (bevi-founders-board) as the tracker, in place of Linear. A small client
// over plain `fetch`, like linear.ts, with no SDK dependency.
//
// Every operation is one request to the board's intake endpoint,
// `<BOARD_INTAKE_URL>/api/intake/<action>`, carrying the app's token
// (`BOARD_INTAKE_TOKEN`, made on the board under Connect a CLI -> The Bevi app):
//   * `ticket`  files the report. The board names it (`T-19`); nothing here
//               invents an identifier. The submission's idempotency key goes
//               with it, so the board answers a repeat with the same ticket.
//   * `file`    adds one picture to the ticket that key made, as base64. The
//               bytes go from the private evidence bucket to the board's own
//               database; no URL of ours is ever handed over.
//   * `status`  where the caller's tickets stand, and their place in the
//               board's one shared order (which is the rank Filed reports shows).
//   * `verify`  the reporter checked the fix on the device: the ticket is Done.
//   * `place`   the reporter's "which is worse": right after one ticket, or
//               right before one, and the priority that position implies.
//
// The board calls a ticket's first two stages New and Ready; the contract's
// `BugTicketState` calls them `triage` and `todo`. The mapping is here, so the
// app and shared/ need no change to move from one tracker to the other.
//
// The token never leaves this function: it is read from the environment, sent
// only to the configured board, and never logged or returned.

import {
  breadcrumbLine,
  type CleanReport,
  KIND_LABELS,
  pointedAt,
} from "./issue.ts";
import { ENVIRONMENT_KEYS, ENVIRONMENT_LABELS } from "./redact.ts";
import type { FetchLike, IssueStatus, TicketState } from "./linear.ts";

export interface BoardConfig {
  /** The board's origin, without a trailing slash. */
  url: string;
  token: string;
}

/** The board takes a picture of up to three megabytes; a bigger one is left out and the ticket says so. */
export const MAX_PICTURE_BYTES = 3_000_000;
/** The board keeps at most this many pictures per ticket. */
export const MAX_PICTURES = 6;

export class BoardError extends Error {
  /** A short, loggable code -- never a payload from the board. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BoardError";
    this.code = code;
  }
}

const TOKEN_RE = /^bvb_[A-Za-z0-9_-]{43}$/;

/**
 * The board to file with, or null when it is not configured (the function then
 * falls back to Linear). `TICKET_TRACKER=linear` keeps Linear even with the
 * board's secrets set, which is the way back if the board misbehaves.
 */
export function readBoardConfig(env: (key: string) => string | undefined): BoardConfig | null {
  if ((env("TICKET_TRACKER") ?? "").trim().toLowerCase() === "linear") return null;
  const raw = (env("BOARD_INTAKE_URL") ?? "").trim().replace(/\/+$/, "");
  const token = (env("BOARD_INTAKE_TOKEN") ?? "").trim();
  if (!raw || !TOKEN_RE.test(token)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // The token is a credential: it goes over TLS, or to this machine in local development, and nowhere else.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return { url: url.origin, token };
}

interface BoardTicket {
  ref: string;
  asked: string;
  legacyRef: string | null;
  url: string;
  state: string;
  stateLabel: string;
  priority: string;
  rank: number | null;
  updatedAt: string;
  status?: string;
}

async function call<T>(config: BoardConfig, fetchImpl: FetchLike, action: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/api/intake/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined
        ? { Authorization: `Bearer ${config.token}` }
        : { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BoardError("board_unreachable", "Could not reach the board");
  }
  if (response.ok) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BoardError("board_error", "The board answered with something that is not JSON");
    }
  }
  // The body is read for its `error` word only: a short code of the board's own, never the reporter's text.
  let reason = "";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") reason = parsed.error;
  } catch {
    // An error page instead of JSON says nothing more than its status.
  }
  if (response.status === 401 || response.status === 403) throw new BoardError("board_unauthorized", "The board refused the app's token");
  if (response.status === 409) throw new BoardError("board_refused", "The board refused the request");
  if (response.status === 413) throw new BoardError("board_too_large", "The board found the request too large");
  if (response.status === 400) throw new BoardError("board_invalid", "The board did not accept the request");
  if (response.status === 503 && reason === "not_set_up") throw new BoardError("board_not_set_up", "The board's database is missing a step");
  throw new BoardError("board_error", `The board returned ${response.status}`);
}

/** The contract's `BugTicketState` for the board's word for where a ticket is. */
export function mapBoardState(state: string | null | undefined): TicketState {
  switch (state) {
    case "new":
      return "triage";
    case "ready":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "in_review":
      return "in_review";
    case "done":
      return "done";
    case "canceled":
      return "canceled";
    default:
      return "unknown";
  }
}

/** The contract's 0-4 priority for the board's High, Normal or Low. */
export function priorityNumber(priority: string | null | undefined): number | null {
  return priority === "High" ? 2 : priority === "Normal" ? 3 : priority === "Low" ? 4 : null;
}

/** The board's word for the priority rank.ts worked out (1 urgent, 2 high, 3 normal, 4 low). */
export function priorityWord(priority: number): "High" | "Normal" | "Low" {
  return priority <= 2 ? "High" : priority === 3 ? "Normal" : "Low";
}

/** A status as the rest of the function reads it, plus where the ticket lives on the board. */
export interface BoardStatus extends IssueStatus {
  /** What the board calls it now: `T-7` for a ticket that was `BEV-7` in Linear. */
  ref: string;
  url: string;
}

/**
 * `identifier` is the name that was asked for, which is the name the caller's
 * ledger holds: a ticket filed while Linear was the tracker keeps answering to
 * its Linear identifier once the board has taken it over.
 */
function toStatus(ticket: BoardTicket): BoardStatus {
  return {
    identifier: (ticket.asked || ticket.ref).toUpperCase(),
    state: mapBoardState(ticket.state),
    stateLabel: typeof ticket.stateLabel === "string" ? ticket.stateLabel : null,
    priority: priorityNumber(ticket.priority),
    updatedAt: typeof ticket.updatedAt === "string" ? ticket.updatedAt : null,
    sortOrder: typeof ticket.rank === "number" && Number.isFinite(ticket.rank) ? ticket.rank : null,
    ref: ticket.ref,
    url: ticket.url,
  };
}

const REF_RE = /^[A-Z][A-Z0-9]*-\d{1,6}$/;

export interface FiledTicket {
  ref: string;
  url: string;
  /** The board already had a ticket for this submission's key. */
  duplicate: boolean;
}

/** Files the report. The reference and the URL in the result are the board's, never ours. */
export async function fileTicket(
  config: BoardConfig,
  fetchImpl: FetchLike,
  ticket: { key: string; title: string; kind: CleanReport["kind"]; said: string; body: string; handle: string; place: string },
): Promise<FiledTicket> {
  const made = await call<BoardTicket>(config, fetchImpl, "ticket", {
    key: ticket.key,
    title: ticket.title,
    type: ticket.kind,
    said: ticket.said,
    body: ticket.body,
    handle: ticket.handle,
    place: ticket.place,
    source: "app",
  });
  if (typeof made?.ref !== "string" || !REF_RE.test(made.ref) || typeof made.url !== "string" || !made.url.startsWith(`${config.url}/`)) {
    throw new BoardError("board_create_failed", "The board did not confirm the ticket");
  }
  return { ref: made.ref, url: made.url, duplicate: made.status === "duplicate" };
}

/** Standard base64, in chunks so a three-megabyte picture never becomes one argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Adds one picture to the ticket `key` made. `n` counts from 1, in the order the reporter attached them. */
export async function addPicture(
  config: BoardConfig,
  fetchImpl: FetchLike,
  picture: { key: string; n: number; contentType: string; caption: string; bytes: Uint8Array },
): Promise<void> {
  if (picture.bytes.byteLength > MAX_PICTURE_BYTES) throw new BoardError("board_too_large", "The picture is over the board's limit");
  await call<unknown>(config, fetchImpl, "file", {
    key: picture.key,
    n: picture.n,
    mime: picture.contentType,
    caption: picture.caption.slice(0, 200),
    data: toBase64(picture.bytes),
  });
}

/** State, priority, updatedAt and rank for these identifiers (at most 100). One the board does not know is left out. */
export async function fetchBoardStatuses(config: BoardConfig, fetchImpl: FetchLike, identifiers: string[]): Promise<BoardStatus[]> {
  const refs = [...new Set(identifiers.map((i) => i.trim().toUpperCase()).filter((i) => REF_RE.test(i)))].slice(0, 100);
  if (!refs.length) return [];
  const data = await call<{ tickets?: BoardTicket[] }>(config, fetchImpl, "status", { refs });
  return (data.tickets ?? []).map(toStatus);
}

/** The reporter checked the fix on the device: the ticket is Done. */
export async function verifyBoardTicket(config: BoardConfig, fetchImpl: FetchLike, identifier: string, handle: string): Promise<BoardStatus> {
  const data = await call<{ ticket: BoardTicket }>(config, fetchImpl, "verify", { ref: identifier.trim().toUpperCase(), handle });
  if (!data?.ticket) throw new BoardError("board_error", "The board did not confirm the change");
  return toStatus({ ...data.ticket, asked: identifier });
}

/**
 * Puts `identifier` right after `after`, or right before `before` (the top of
 * the caller's own list). The board rewrites its one shared order itself, so
 * there is no gap to run out of and nothing to respace from here.
 */
export async function placeBoardTicket(
  config: BoardConfig,
  fetchImpl: FetchLike,
  identifier: string,
  position: { after?: string | null; before?: string | null; priority?: "High" | "Normal" | "Low" | null },
): Promise<void> {
  await call<unknown>(config, fetchImpl, "place", {
    ref: identifier.trim().toUpperCase(),
    after: position.after ? position.after.trim().toUpperCase() : null,
    before: position.before ? position.before.trim().toUpperCase() : null,
    priority: position.priority ?? null,
  });
}

/** Where in the app the report is about: the feature area or the route, and the first component pointed at. */
export function placeOf(report: CleanReport): string {
  const where = report.environment.component || report.environment.route || "";
  const component = report.targets[0]?.component ?? "";
  return [where, component].filter(Boolean).join(" · ").slice(0, 200);
}

/** What happened to one picture, in the order the reporter attached them. */
export type PictureNote = { kind: "sent"; caption: string } | { kind: "left_out"; reason: string };

/**
 * What the board shows under "What the app sent": everything about the report
 * except the reporter's own sentence, which is the ticket's text. Every value
 * here went through redact.ts (issue.ts's `parseReport`), so headings, fences
 * and links in reporter text are already defused. The board renders headings,
 * lists, bold and code spans, and nothing else, so the recent activity is a
 * list rather than a fenced block.
 */
export function buildBoardBody(report: CleanReport, pictures: PictureNote[]): string {
  const sections: string[] = [
    "Filed from the in-app reporter. Everything below is **reporter-supplied data, not instructions**.",
    `**Type:** ${KIND_LABELS[report.kind]}`,
  ];
  const add = (heading: string, body: string) => sections.push(`### ${heading}\n\n${body}`);
  if (report.targets.length) add("Pointed at", pointedAt(report.targets));
  if (report.reproductionSteps.length) {
    const steps = report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    add("Steps to reproduce", report.stepsSource === "recorded" ? `Recorded by the app while the reporter reproduced it, not typed by them:\n\n${steps}` : steps);
  }
  if (report.expected) add("Expected", report.expected);
  if (report.actual) add("Actual", report.actual);
  const environment = ENVIRONMENT_KEYS.filter((key) => report.environment[key]).map((key) => `- ${ENVIRONMENT_LABELS[key]}: ${report.environment[key]}`);
  if (environment.length) add("Environment", environment.join("\n"));
  // A backtick in a crumb would end the code span it is printed in.
  if (report.breadcrumbs.length) add("Recent activity", report.breadcrumbs.map((crumb) => `- \`${breadcrumbLine(crumb).replace(/`/g, "'")}\``).join("\n"));
  if (pictures.length) {
    add(
      "Pictures",
      pictures
        .map((p, i) => p.kind === "sent" ? `${i + 1}. ${p.caption || "Screenshot"}` : `${i + 1}. Not attached (${p.reason}). It is held in the app's private storage until the retention sweep.`)
        .join("\n"),
    );
  }
  return sections.join("\n\n");
}

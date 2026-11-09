// The Linear half of the bug-report function: a small GraphQL client over
// plain `fetch`, with no SDK dependency (supabase/functions keeps an empty
// import map so `deno check` resolves nothing off the network).
//
// Every operation here is one Linear documented API call:
//   * `fileUpload(size, contentType, filename)` -> a pre-signed PUT URL plus
//     the asset URL to reference afterwards. This is how a screenshot gets
//     into Linear's own storage; we never hand Linear a URL of ours, and we
//     never make the evidence object public.
//   * `issueCreate(input: IssueCreateInput)` -> the issue, with `identifier`
//     ('BEV-104') and `url`. The identifier comes from Linear; nothing in this
//     repo invents one.
//   * `team(id) { states }` -> the team's workflow states, to find the Triage
//     state (where a new report lands) and the Done state (where a verified
//     one goes) once per cold start when the ids are not configured.
//   * `issueLabels(filter: { name: { in } })` -> the workspace's and the team's
//     labels of the four kind names (Bug, Fix suggestion, Idea, Design nit),
//     since Linear's default `Bug` label lives at workspace level.
//   * `issues(filter)` -> state, priority and updatedAt for the caller's
//     tickets, which My reports shows.
//   * `issue(id)` + `issueUpdate` -> the one write after create: moving a
//     ticket the reporter verified on the device to Done.
//
// Priority IS set on create, from the reporter's severity (docs/bug-workflow.md):
// Blocker 1, Bad 2, Annoying 3, Polish 4. Triage can still change it with the
// board in view; Linear's value is the truth from then on.

import { type Kind, KIND_LABELS } from "./issue.ts";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

/** Injected so tests can drive the client without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LinearConfig {
  apiKey: string;
  teamId: string;
  projectId?: string;
  /** Labels on every submission, e.g. one "from the app" label. */
  labelIds?: string[];
  /** Skips the workflow-state lookup when set. */
  triageStateId?: string;
  /** Skips the done-state lookup when set. */
  doneStateId?: string;
  /** Per-kind label ids from the environment; a kind without one is looked up by name. */
  labelIdByKind?: Partial<Record<Kind, string>>;
}

export class LinearError extends Error {
  /** A short, loggable code -- never a provider payload. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LinearError";
    this.code = code;
  }
}

/**
 * Personal API keys (`lin_api_...`) go in `Authorization` raw; OAuth access
 * tokens (`lin_oauth_...`) are Bearer tokens. Accepting both means a workspace
 * can move from one to the other without a code change.
 */
export function authorizationHeader(apiKey: string): string {
  return apiKey.startsWith("lin_oauth_") ? `Bearer ${apiKey}` : apiKey;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

async function graphql<T>(config: LinearConfig, fetchImpl: FetchLike, query: string, variables: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader(config.apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new LinearError("linear_unreachable", "Could not reach Linear");
  }

  if (response.status === 401 || response.status === 403) {
    throw new LinearError("linear_unauthorized", "Linear rejected the API key");
  }
  if (response.status === 429) throw new LinearError("linear_rate_limited", "Linear rate limited the request");
  if (!response.ok) throw new LinearError("linear_error", `Linear returned ${response.status}`);

  let body: GraphQLResponse<T>;
  try {
    body = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new LinearError("linear_error", "Linear returned a response that was not JSON");
  }
  if (body.errors?.length) {
    // The provider's message can quote our request back; it never reaches the
    // client or the ticket, only the function's own log line.
    throw new LinearError("linear_error", body.errors[0]?.message ?? "Linear returned an error");
  }
  if (!body.data) throw new LinearError("linear_error", "Linear returned no data");
  return body.data;
}

// ---------------------------------------------------------------------------
// Workflow states
// ---------------------------------------------------------------------------

const TEAM_STATES_QUERY = `
  query TeamStates($teamId: String!) {
    team(id: $teamId) { states(first: 50) { nodes { id name type } } }
  }
`;

interface TeamStatesData {
  team: { states: { nodes: { id: string; name: string; type: string }[] } } | null;
}

/**
 * The team's Triage state id, or null when the team has no triage state (then
 * the issue is created in the team's default state and the Linear view does
 * the sorting). Resolved once per cold start.
 */
export async function findTriageStateId(config: LinearConfig, fetchImpl: FetchLike): Promise<string | null> {
  if (config.triageStateId) return config.triageStateId;
  const data = await graphql<TeamStatesData>(config, fetchImpl, TEAM_STATES_QUERY, { teamId: config.teamId });
  const nodes = data.team?.states.nodes ?? [];
  const byType = nodes.find((s) => s.type === "triage");
  if (byType) return byType.id;
  const byName = nodes.find((s) => s.name.toLowerCase() === "triage");
  return byName?.id ?? null;
}

/**
 * The team's Done state id: the `completed` state named Done when there is
 * one, else the first `completed` state, else null (a team with no completed
 * state cannot have a ticket verified from the app).
 */
export async function findDoneStateId(config: LinearConfig, fetchImpl: FetchLike): Promise<string | null> {
  if (config.doneStateId) return config.doneStateId;
  const data = await graphql<TeamStatesData>(config, fetchImpl, TEAM_STATES_QUERY, { teamId: config.teamId });
  const completed = (data.team?.states.nodes ?? []).filter((s) => s.type === "completed");
  const named = completed.find((s) => s.name.toLowerCase() === "done");
  return (named ?? completed[0])?.id ?? null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const KIND_LABELS_QUERY = `
  query KindLabels($names: [String!]!) {
    issueLabels(first: 250, filter: { name: { in: $names } }) { nodes { id name team { id } } }
  }
`;

interface KindLabelsData {
  issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
}

/**
 * The ids of the four kind labels, keyed by lower-cased name. A Linear label
 * can live at workspace level (`team` is null; the default `Bug` label does)
 * or on one team, so this asks for the names across the workspace and keeps a
 * node when it is workspace-wide or belongs to our team -- preferring the
 * team's own when both exist -- and ignores another team's label of the same
 * name. Resolved once per cold start.
 */
export async function fetchKindLabels(config: LinearConfig, fetchImpl: FetchLike): Promise<Record<string, string>> {
  const names = (Object.keys(KIND_LABELS) as Kind[]).map((kind) => KIND_LABELS[kind]);
  const data = await graphql<KindLabelsData>(config, fetchImpl, KIND_LABELS_QUERY, { names });
  const out: Record<string, string> = {};
  const teamScoped = new Set<string>();
  for (const label of data.issueLabels?.nodes ?? []) {
    const key = label.name.trim().toLowerCase();
    if (label.team === null || label.team === undefined) {
      if (!teamScoped.has(key)) out[key] = label.id;
    } else if (label.team.id === config.teamId) {
      out[key] = label.id;
      teamScoped.add(key);
    }
  }
  return out;
}

/**
 * The label id for a report's kind: the environment override first, then the
 * label whose name matches (`Bug`, `Fix suggestion`, `Idea`, `Design nit`),
 * else null -- a workspace that has not created the label still gets its
 * issue, just without it.
 */
export function labelIdForKind(kind: Kind, config: LinearConfig, labelsByName: Record<string, string> | null): string | null {
  const configured = config.labelIdByKind?.[kind];
  if (configured) return configured;
  return labelsByName?.[KIND_LABELS[kind].toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const FILE_UPLOAD_MUTATION = `
  mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
    fileUpload(contentType: $contentType, filename: $filename, size: $size) {
      success
      uploadFile { uploadUrl assetUrl headers { key value } }
    }
  }
`;

interface FileUploadData {
  fileUpload: {
    success: boolean;
    uploadFile: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] } | null;
  } | null;
}

/**
 * Puts the bytes into Linear's own storage and returns the asset URL to embed.
 * Two calls: ask Linear for a pre-signed URL, then PUT to it with exactly the
 * headers Linear returned (the signature covers them).
 */
export async function uploadFile(
  config: LinearConfig,
  fetchImpl: FetchLike,
  file: { bytes: Uint8Array; contentType: string; filename: string },
): Promise<string> {
  const data = await graphql<FileUploadData>(config, fetchImpl, FILE_UPLOAD_MUTATION, {
    contentType: file.contentType,
    filename: file.filename,
    size: file.bytes.byteLength,
  });
  const upload = data.fileUpload?.uploadFile;
  if (!data.fileUpload?.success || !upload) throw new LinearError("linear_upload_refused", "Linear refused the upload");

  const headers: Record<string, string> = { "Content-Type": file.contentType };
  for (const h of upload.headers) headers[h.key] = h.value;

  let put: Response;
  try {
    put = await fetchImpl(upload.uploadUrl, {
      method: "PUT",
      headers,
      // A fresh view over the same buffer: `fetch` wants a BodyInit, and
      // passing the Uint8Array directly is not portable across runtimes.
      body: file.bytes.slice().buffer as ArrayBuffer,
    });
  } catch {
    throw new LinearError("linear_upload_unreachable", "Could not reach Linear's upload endpoint");
  }
  if (!put.ok) throw new LinearError("linear_upload_failed", `Linear's upload endpoint returned ${put.status}`);
  return upload.assetUrl;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { id identifier url } }
  }
`;

interface IssueCreateData {
  issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null } | null;
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
}

/** Creates the issue. The identifier and URL in the result are Linear's, never ours. */
export async function createIssue(
  config: LinearConfig,
  fetchImpl: FetchLike,
  issue: { title: string; description: string; stateId: string | null; priority?: number; labelIds?: string[] },
): Promise<CreatedIssue> {
  const input: Record<string, unknown> = {
    teamId: config.teamId,
    title: issue.title,
    description: issue.description,
  };
  if (issue.stateId) input.stateId = issue.stateId;
  if (config.projectId) input.projectId = config.projectId;
  if (issue.priority !== undefined) input.priority = issue.priority;
  const labelIds = [...new Set([...(config.labelIds ?? []), ...(issue.labelIds ?? [])])];
  if (labelIds.length) input.labelIds = labelIds;

  const data = await graphql<IssueCreateData>(config, fetchImpl, ISSUE_CREATE_MUTATION, { input });
  const created = data.issueCreate?.issue;
  if (!data.issueCreate?.success || !created?.identifier || !created.url) {
    throw new LinearError("linear_create_failed", "Linear did not confirm the issue");
  }
  return created;
}

/** The contract's `BugTicketState` (shared/src/api.ts), derived from Linear's state type. */
export type TicketState = "triage" | "todo" | "in_progress" | "in_review" | "done" | "canceled" | "unknown";

/**
 * Linear's state *types* are fixed (triage, backlog, unstarted, started,
 * completed, canceled); the *names* are the team's own. "In review" is a
 * started state in Linear's model, so the name decides between in_progress
 * and in_review.
 */
export function mapStateType(type: string | null | undefined, name: string | null | undefined): TicketState {
  switch (type) {
    case "triage":
      return "triage";
    case "backlog":
    case "unstarted":
      return "todo";
    case "started":
      return (name ?? "").toLowerCase().includes("review") ? "in_review" : "in_progress";
    case "completed":
      return "done";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "unknown";
  }
}

export interface IssueStatus {
  identifier: string;
  state: TicketState;
  stateLabel: string | null;
  priority: number | null;
  updatedAt: string | null;
}

interface IssueNode {
  identifier: string;
  state: { name: string; type: string } | null;
  priority: number | null;
  updatedAt: string | null;
}

function toStatus(node: IssueNode): IssueStatus {
  return {
    identifier: node.identifier,
    state: mapStateType(node.state?.type, node.state?.name),
    stateLabel: node.state?.name ?? null,
    priority: typeof node.priority === "number" ? node.priority : null,
    updatedAt: node.updatedAt ?? null,
  };
}

const ISSUE_STATUSES_QUERY = `
  query IssueStatuses($teamId: ID!, $numbers: [Float!]!) {
    issues(filter: { team: { id: { eq: $teamId } }, number: { in: $numbers } }, first: 50) {
      nodes { identifier state { name type } priority updatedAt }
    }
  }
`;

interface IssueStatusesData {
  issues: { nodes: IssueNode[] };
}

/** The issue number in an identifier like 'BEV-104', or null for anything else. */
export function issueNumber(identifier: string): number | null {
  const m = /^[A-Z][A-Z0-9]*-(\d{1,9})$/.exec(identifier.trim());
  return m ? Number(m[1]) : null;
}

/** State, priority and updatedAt for the team's issues with these numbers (at most 50). */
export async function fetchIssueStatuses(config: LinearConfig, fetchImpl: FetchLike, numbers: number[]): Promise<IssueStatus[]> {
  if (!numbers.length) return [];
  const data = await graphql<IssueStatusesData>(config, fetchImpl, ISSUE_STATUSES_QUERY, {
    teamId: config.teamId,
    numbers: numbers.slice(0, 50),
  });
  return (data.issues?.nodes ?? []).map(toStatus);
}

const ISSUE_ID_QUERY = `
  query IssueId($id: String!) {
    issue(id: $id) { id }
  }
`;

interface IssueIdData {
  issue: { id: string } | null;
}

/** Linear's internal id for an identifier like 'BEV-104' (its `issue` query accepts either). */
export async function findIssueId(config: LinearConfig, fetchImpl: FetchLike, identifier: string): Promise<string | null> {
  const data = await graphql<IssueIdData>(config, fetchImpl, ISSUE_ID_QUERY, { id: identifier });
  return data.issue?.id ?? null;
}

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { identifier state { name type } priority updatedAt }
    }
  }
`;

interface IssueUpdateData {
  issueUpdate: { success: boolean; issue: IssueNode | null } | null;
}

/** Moves one issue to a state and returns what Linear says it is now. */
export async function updateIssueState(
  config: LinearConfig,
  fetchImpl: FetchLike,
  issueId: string,
  stateId: string,
): Promise<IssueStatus> {
  const data = await graphql<IssueUpdateData>(config, fetchImpl, ISSUE_UPDATE_MUTATION, { id: issueId, input: { stateId } });
  const issue = data.issueUpdate?.issue;
  if (!data.issueUpdate?.success || !issue) throw new LinearError("linear_update_failed", "Linear did not confirm the update");
  return toStatus(issue);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LABEL_ENV_BY_KIND: Record<Kind, string> = {
  bug: "LINEAR_LABEL_BUG",
  fix: "LINEAR_LABEL_FIX",
  idea: "LINEAR_LABEL_IDEA",
  design: "LINEAR_LABEL_DESIGN",
};

/** Reads the provider configuration from the environment. Returns null when it is incomplete. */
export function readLinearConfig(env: (key: string) => string | undefined): LinearConfig | null {
  const apiKey = env("LINEAR_API_KEY");
  const teamId = env("LINEAR_TEAM_ID");
  if (!apiKey || !teamId) return null;
  const labels = env("LINEAR_LABEL_IDS");
  const labelIdByKind: Partial<Record<Kind, string>> = {};
  for (const kind of Object.keys(LABEL_ENV_BY_KIND) as Kind[]) {
    const id = env(LABEL_ENV_BY_KIND[kind]);
    if (id) labelIdByKind[kind] = id;
  }
  return {
    apiKey,
    teamId,
    projectId: env("LINEAR_PROJECT_ID") || undefined,
    triageStateId: env("LINEAR_TRIAGE_STATE_ID") || undefined,
    doneStateId: env("LINEAR_DONE_STATE_ID") || undefined,
    labelIds: labels
      ? labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    labelIdByKind: Object.keys(labelIdByKind).length ? labelIdByKind : undefined,
  };
}

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
//     state id once per cold start when LINEAR_TRIAGE_STATE_ID is not set.
//
// Priority is deliberately NOT set on create: the spec's P0-P3 names are ours,
// Linear's numeric priority is its own, and triage is where a human assigns it.

export const LINEAR_API_URL = "https://api.linear.app/graphql";

/** Injected so tests can drive the client without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LinearConfig {
  apiKey: string;
  teamId: string;
  projectId?: string;
  labelIds?: string[];
  /** Skips the workflow-state lookup when set. */
  triageStateId?: string;
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
  issue: { title: string; description: string; stateId: string | null },
): Promise<CreatedIssue> {
  const input: Record<string, unknown> = {
    teamId: config.teamId,
    title: issue.title,
    description: issue.description,
  };
  if (issue.stateId) input.stateId = issue.stateId;
  if (config.projectId) input.projectId = config.projectId;
  if (config.labelIds?.length) input.labelIds = config.labelIds;

  const data = await graphql<IssueCreateData>(config, fetchImpl, ISSUE_CREATE_MUTATION, { input });
  const created = data.issueCreate?.issue;
  if (!data.issueCreate?.success || !created?.identifier || !created.url) {
    throw new LinearError("linear_create_failed", "Linear did not confirm the issue");
  }
  return created;
}

/** Reads the provider configuration from the environment. Returns null when it is incomplete. */
export function readLinearConfig(env: (key: string) => string | undefined): LinearConfig | null {
  const apiKey = env("LINEAR_API_KEY");
  const teamId = env("LINEAR_TEAM_ID");
  if (!apiKey || !teamId) return null;
  const labels = env("LINEAR_LABEL_IDS");
  return {
    apiKey,
    teamId,
    projectId: env("LINEAR_PROJECT_ID") || undefined,
    triageStateId: env("LINEAR_TRIAGE_STATE_ID") || undefined,
    labelIds: labels
      ? labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  };
}

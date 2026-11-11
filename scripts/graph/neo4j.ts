/**
 * A tiny client for Neo4j's HTTPS Query API v2, for the nightly graph sync
 * (scripts/graph/sync.ts).
 *
 * Node 22, `--experimental-strip-types`, NO DEPENDENCIES: the official driver
 * speaks Bolt, and Aura exposes port 443 only, so everything in this repo
 * talks to `https://<host>/db/<database>/query/v2` with `fetch` (docs/graph.md,
 * "Transport"). `apply-schema.ts` and `keepalive.ts` keep their own one-shot
 * `run()`; this file adds the two things the sync needs and they do not:
 * EXPLICIT TRANSACTIONS and a typed error that knows whether it is worth
 * retrying.
 *
 * The wire protocol, as measured against the live 5.27-aura instance:
 *
 *   POST   {base}            { statement, parameters }   -> 202   one implicit transaction
 *   POST   {base}/tx         {}                          -> 202   { transaction: { id, expires } }
 *   POST   {base}/tx/{id}    { statement, parameters }   -> 202
 *   POST   {base}/tx/{id}/commit                         -> 202
 *   DELETE {base}/tx/{id}                                -> 200   (roll back)
 *
 * `POST {base}/tx` answers with a `neo4j-cluster-affinity` header that MUST be
 * echoed on every later request of that transaction, or the request can land
 * on a cluster member that has never heard of it. An open transaction expires
 * after about 30 seconds idle; every request extends it.
 *
 * An `errors` array can arrive under a 2xx status, so it is always checked.
 *
 * WHAT NEVER APPEARS IN A MESSAGE OR A LOG LINE: the Authorization header, the
 * password, the username, the database name, the host and the URL. On this
 * instance the instance id is the host, the username AND the database, and the
 * repository's Actions logs are public. Server messages are passed through
 * `redact`, which also blanks any 64-hex run -- the shape of a
 * `(:User).pseudonym` -- because a constraint violation quotes the offending
 * property value.
 */

import { queryApiUrl } from "./apply-schema.ts";

export const NEO4J_ENV = ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "NEO4J_DATABASE"] as const;

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The names in `names` that are unset or blank in `env`, in the order given. */
export function missingEnv(env: Env, names: readonly string[]): string[] {
  return names.filter((name) => (env[name] ?? "").trim() === "");
}

/**
 * All four are required. `NEO4J_DATABASE` has no default here on purpose:
 * `neo4j` is wrong for an Aura Free instance whose database is named after its
 * id, and a wrong default fails later and less legibly than a missing name.
 * One error names every missing variable.
 */
export function neo4jConfigFromEnv(env: Env): Neo4jConfig {
  const missing = missingEnv(env, NEO4J_ENV);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")}. All four NEO4J_* values are required (the database is NOT "neo4j" on this instance). ` +
        `Put them in supabase/.env (gitignored) or the environment; see docs/graph.md.`,
    );
  }
  return {
    uri: (env.NEO4J_URI as string).trim(),
    username: (env.NEO4J_USERNAME as string).trim(),
    password: env.NEO4J_PASSWORD as string,
    database: (env.NEO4J_DATABASE as string).trim(),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Client-side codes that still mean "the transaction is gone, start again":
 * an expired or unknown transaction, and the two a cluster hands out during a
 * leader switch (the official drivers retry the same set).
 */
const RETRYABLE_CLIENT_CODES: ReadonlySet<string> = new Set([
  "Neo.ClientError.Transaction.TransactionNotFound",
  "Neo.ClientError.Transaction.TransactionTimedOut",
  "Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration",
  "Neo.ClientError.Request.TransactionNotFound",
  "Neo.ClientError.Cluster.NotALeader",
  "Neo.ClientError.General.ForbiddenOnReadOnlyDatabase",
  "Neo.ClientError.Security.AuthorizationExpired",
]);

export interface Neo4jErrorInit {
  message: string;
  code: string | null;
  status: number | null;
  statement: string;
  transient: boolean;
}

/**
 * Every failure this client raises. `transient` is the one bit the sync reads:
 * true for a network failure, HTTP 429 or 5xx, a `Neo.TransientError.*` code
 * and an expired or unknown transaction -- the cases where running the whole
 * sync again in a fresh transaction can succeed.
 */
export class Neo4jError extends Error {
  /** The Neo4j status code, e.g. `Neo.ClientError.Statement.SyntaxError`, when the server sent one. */
  readonly code: string | null;
  /** The HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /** The first line of the statement, or the protocol step (`BEGIN`, `COMMIT`, `ROLLBACK`). */
  readonly statement: string;
  readonly transient: boolean;

  constructor(init: Neo4jErrorInit) {
    super(init.message);
    this.name = "Neo4jError";
    this.code = init.code;
    this.status = init.status;
    this.statement = init.statement;
    this.transient = init.transient;
  }
}

export function isTransient(error: unknown): boolean {
  return error instanceof Neo4jError && error.transient;
}

/** The first line of a statement, for an error message. Statements are fixed constants, so this is never data. */
export function statementHead(statement: string): string {
  const line = statement.trim().split(/\r?\n/)[0] ?? "";
  return line.trim().slice(0, 120);
}

function hostOf(uri: string): string {
  return uri.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

/**
 * A function that blanks this config's secrets out of any text: the Query API
 * URL, the password, the username, the database, the host (and its first
 * label, the instance id), the Basic-auth token, and any 64-hex run.
 */
export function redactor(config: Neo4jConfig): (text: string) => string {
  const host = hostOf(config.uri);
  const basic = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const url = queryApiUrl(config.uri, config.database);
  const secrets = [url, config.uri, basic, config.password, host, host.split(".")[0] ?? "", config.username, config.database]
    .filter((value) => value.length >= 3)
    // Longest first, so a secret that contains another is replaced whole.
    .sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join("[redacted]");
    return out.replace(/[0-9a-f]{64}/gi, "[redacted]");
  };
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;
export type Parameters = Record<string, unknown>;

/** Anything that can run one statement: the client (implicit transaction) or an open transaction. */
export interface Neo4jRunner {
  run(statement: string, parameters?: Parameters): Promise<Row[]>;
}

export interface Neo4jTransaction extends Neo4jRunner {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Neo4jClient {
  /** One statement in its own implicit transaction. Rows come back as objects keyed by the RETURN aliases. */
  query(statement: string, parameters?: Parameters): Promise<Row[]>;
  beginTransaction(): Promise<Neo4jTransaction>;
}

export interface Neo4jClientOptions {
  /** Injectable so the tests need no network. */
  fetch?: typeof fetch;
  /** Per-request timeout. Well under the server's ~30 s idle expiry would be wrong: one batch can take seconds. */
  timeoutMs?: number;
}

const AFFINITY_HEADER = "neo4j-cluster-affinity";
const DEFAULT_TIMEOUT_MS = 60_000;

interface ApiBody {
  data?: { fields?: string[]; values?: unknown[][] };
  transaction?: { id?: string; expires?: string };
  errors?: Array<{ code?: string; message?: string }>;
}

export function createNeo4jClient(config: Neo4jConfig, options: Neo4jClientOptions = {}): Neo4jClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = queryApiUrl(config.uri, config.database);
  const redact = redactor(config);
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;

  /**
   * One HTTP exchange. `what` is the statement head or the protocol step, and
   * is the only description of the request that reaches an error: never the
   * URL, never a header.
   */
  const exchange = async (
    method: "POST" | "DELETE",
    path: string,
    body: unknown,
    what: string,
    affinity: string | null,
  ): Promise<{ body: ApiBody; affinity: string | null }> => {
    const headers: Record<string, string> = {
      Authorization: authorization,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (affinity !== null) headers[AFFINITY_HEADER] = affinity;

    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error: unknown) {
      // `fetch failed` carries the host in its cause (ENOTFOUND <host>), so the
      // cause is reduced to its error code and nothing else is quoted.
      const name = error instanceof Error ? error.name : "Error";
      const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
      const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      throw new Neo4jError({
        message: timedOut
          ? `no response within ${timeoutMs} ms\n  statement: ${what}`
          : `network failure${code}: the instance is unreachable or paused (resuming is a manual console action; docs/graph.md)\n  statement: ${what}`,
        code: null,
        status: null,
        statement: what,
        transient: true,
      });
    }

    let parsed: ApiBody = {};
    if (text.trim() !== "") {
      try {
        parsed = JSON.parse(text) as ApiBody;
      } catch {
        parsed = {};
      }
    }
    const first = parsed.errors?.[0];
    if (!response.ok || first !== undefined) {
      const code = typeof first?.code === "string" ? first.code : null;
      const inTransaction = path.startsWith("/tx/");
      const transient =
        response.status === 429 ||
        response.status >= 500 ||
        (code !== null && (code.startsWith("Neo.TransientError.") || RETRYABLE_CLIENT_CODES.has(code))) ||
        // An unknown transaction id: it expired, or the request reached a
        // member that never had it.
        (inTransaction && response.status === 404);
      const detail = (parsed.errors ?? [])
        .map((e) => e.message ?? "")
        .filter((m) => m !== "")
        .join("; ");
      throw new Neo4jError({
        message:
          `HTTP ${response.status}${code === null ? "" : ` ${code}`}\n  statement: ${what}` +
          (detail === "" ? "" : `\n  ${redact(detail).slice(0, 600)}`),
        code,
        status: response.status,
        statement: what,
        transient,
      });
    }
    return { body: parsed, affinity: response.headers.get(AFFINITY_HEADER) };
  };

  const rowsOf = (body: ApiBody): Row[] => {
    const fields = body.data?.fields ?? [];
    return (body.data?.values ?? []).map((values) => Object.fromEntries(fields.map((field, i) => [field, values[i]])));
  };

  return {
    async query(statement, parameters = {}) {
      const result = await exchange("POST", "", { statement, parameters }, statementHead(statement), null);
      return rowsOf(result.body);
    },

    async beginTransaction() {
      const begun = await exchange("POST", "/tx", {}, "BEGIN", null);
      const id = begun.body.transaction?.id;
      if (typeof id !== "string" || id === "") {
        throw new Neo4jError({
          message: "the server opened no transaction (no transaction.id in the response)\n  statement: BEGIN",
          code: null,
          status: null,
          statement: "BEGIN",
          transient: false,
        });
      }
      const affinity = begun.affinity;
      const path = `/tx/${encodeURIComponent(id)}`;
      let open = true;

      return {
        async run(statement, parameters = {}) {
          const result = await exchange("POST", path, { statement, parameters }, statementHead(statement), affinity);
          return rowsOf(result.body);
        },
        async commit() {
          await exchange("POST", `${path}/commit`, {}, "COMMIT", affinity);
          open = false;
        },
        async rollback() {
          if (!open) return;
          open = false;
          await exchange("DELETE", path, undefined, "ROLLBACK", affinity);
        },
      };
    },
  };
}

/**
 * The paged PostgREST client the graph sync reads Postgres with
 * (scripts/graph/sync.ts).
 *
 * The same behaviour as the `client()` inside `build-edges.ts` and
 * `build-neighbours.ts`: `fetch` and a service-role key, no dependencies,
 * `limit`/`offset` paging at 1000 rows. Those two jobs keep their own private
 * copies on purpose -- they are working nightly entry points and this file was
 * not allowed to become a reason to touch them. The one addition here is an
 * injectable `fetch`, so the paging can be tested without a database.
 *
 * `max_rows = 1000` in supabase/config.toml applies to "a view, table, OR
 * STORED PROCEDURE", so a read that is not paged is silently truncated at 1000
 * rows. `bev_edges` holds about 4,700.
 *
 * EVERY PATH MUST CARRY A TOTAL ORDER (`order=` on the primary key), because
 * `limit`/`offset` over an unordered result can repeat or skip rows.
 *
 * Every failure is a `PostgrestError` that carries the HTTP status (null when
 * no response arrived) and one bit, `transient`: a network failure, HTTP 429
 * or a 5xx, the cases where the same request can succeed a moment later. The
 * sync retries its one idempotent write (`replace_bev_graph_stats`) on that
 * bit and on nothing else; a 4xx is the caller's bug or a missing function
 * and will not fix itself.
 */

export const PAGE = 1000;

export interface PostgrestClient {
  select<T>(path: string): Promise<T[]>;
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
  rpcRows<T>(name: string, body: Record<string, unknown>): Promise<T[]>;
}

export interface PostgrestErrorInit {
  message: string;
  /** The HTTP status, or null when no response arrived. */
  status: number | null;
  path: string;
}

/** Every failure this client raises. The message has already been through `redactIds`. */
export class PostgrestError extends Error {
  readonly status: number | null;
  readonly path: string;
  /** True for a network failure, HTTP 429 and any 5xx. Never for another 4xx. */
  readonly transient: boolean;

  constructor(init: PostgrestErrorInit) {
    super(init.message);
    this.name = "PostgrestError";
    this.status = init.status;
    this.path = init.path;
    this.transient = init.status === null || init.status === 429 || init.status >= 500;
  }
}

export function isTransientPostgrestError(error: unknown): boolean {
  return error instanceof PostgrestError && error.transient;
}

/** Blanks uuids and 64-hex runs (the shape of a user id and of a pseudonym) in text bound for a public log. */
export function redactIds(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/[0-9a-f]{64}/gi, "<hex>");
}

export function createPostgrestClient(url: string, key: string, doFetch: typeof fetch = fetch): PostgrestClient {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
      text = await response.text();
    } catch (error: unknown) {
      // No response at all. The cause of a `fetch failed` names the host, so
      // it is reduced to its error code, as neo4j.ts does.
      const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
      const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
      throw new PostgrestError({ message: `network failure${code} on ${path}`, status: null, path });
    }
    if (!response.ok) {
      // The key is in a header, not the URL, so the path is safe to print. The
      // body of a PostgREST error is its own {code, message, hint}, not rows,
      // but a hint can quote a value, and this log is public: anything shaped
      // like a uuid or a 64-hex pseudonym is blanked, as neo4j.ts does.
      throw new PostgrestError({
        message: `${response.status} ${response.statusText} on ${path}\n  ${redactIds(text.slice(0, 600))}`,
        status: response.status,
        path,
      });
    }
    return text === "" ? null : JSON.parse(text);
  };

  const paged = async <T>(path: string, init?: RequestInit): Promise<T[]> => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const sep = path.includes("?") ? "&" : "?";
      const page = (await request(`${path}${sep}limit=${PAGE}&offset=${offset}`, init)) as T[];
      if (!Array.isArray(page)) throw new Error(`expected an array from ${path}`);
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };

  return {
    select: <T>(path: string) => paged<T>(path),
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      return (await request(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) })) as T;
    },
    rpcRows: <T>(name: string, body: Record<string, unknown>) =>
      paged<T>(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }),
  };
}

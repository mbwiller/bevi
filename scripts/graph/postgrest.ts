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
 */

export const PAGE = 1000;

export interface PostgrestClient {
  select<T>(path: string): Promise<T[]>;
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
  rpcRows<T>(name: string, body: Record<string, unknown>): Promise<T[]>;
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
    const response = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    const text = await response.text();
    if (!response.ok) {
      // The key is in a header, not the URL, so the path is safe to print. The
      // body of a PostgREST error is its own {code, message, hint}, not rows.
      throw new Error(`${response.status} ${response.statusText} on ${path}\n  ${text.slice(0, 600)}`);
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

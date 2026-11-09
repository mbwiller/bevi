// The ledger half of the bug-report function that is worth testing on its
// own: the PostgREST query the status and verify routes read with, and the
// service-role write that records a ticket. Pure apart from the injected
// `fetch`, so test.ts can drive both without a server.

/** Where the function's log lines go; injected so a test can stay quiet. */
export type Logger = (line: string) => void;

export interface LedgerEnv {
  url: string;
  serviceRoleKey: string;
}

/**
 * The caller's created tickets, newest first. The query names the reporter
 * explicitly as well as reading through RLS: the select policy on
 * `bug_reports` also admits an admin, and an admin's own tickets are still
 * the only ones My reports should list or `verify` should move.
 */
export function ledgerQuery(userId: string, options: { ticketId?: string; limit: number }): string {
  const parts = [
    "select=id,ticket_identifier,ticket_url,title,kind,severity,created_at,updated_at",
    `reporter_id=eq.${encodeURIComponent(userId)}`,
    "state=eq.created",
  ];
  if (options.ticketId) parts.push(`ticket_identifier=eq.${encodeURIComponent(options.ticketId)}`);
  parts.push("order=created_at.desc", `limit=${options.limit}`);
  return `bug_reports?${parts.join("&")}`;
}

export interface FinishOutcome {
  identifier?: string;
  url?: string;
  errorCode?: string;
}

/**
 * Records the outcome against the ledger row as the service role, trying
 * twice. Returns whether the write was confirmed.
 *
 * This write matters more than it looks: once `createIssue` has succeeded, a
 * row left `pending` goes stale after two minutes and the next retry of the
 * same draft re-claims it and creates a SECOND Linear ticket. So a non-2xx
 * answer is retried once and, if it still fails, logged with its status code
 * (never the body, which can quote the request) while the created ticket is
 * still returned to the reporter -- the ticket exists, and a loud log line is
 * better than a 500 that would make them file it again.
 */
export async function finishBugReport(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  env: LedgerEnv,
  id: number,
  state: "created" | "failed",
  extra: FinishOutcome,
  log: Logger = (line) => console.error(line),
): Promise<boolean> {
  let lastStatus: number | "unreachable" = "unreachable";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchImpl(`${env.url}/rest/v1/rpc/finish_bug_report`, {
        method: "POST",
        headers: {
          apikey: env.serviceRoleKey,
          Authorization: `Bearer ${env.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_id: id,
          p_state: state,
          p_ticket_identifier: extra.identifier ?? null,
          p_ticket_url: extra.url ?? null,
          p_error_code: extra.errorCode ?? null,
        }),
      });
      if (response.ok) return true;
      lastStatus = response.status;
    } catch {
      lastStatus = "unreachable";
    }
  }
  log(`bug-report: finish_bug_report failed id=${id} state=${state} status=${lastStatus}; the row stays pending and a retry after the stale window could file a second ticket`);
  return false;
}

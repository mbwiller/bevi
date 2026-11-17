// CORS for the bug-report function.
//
// This is the first Edge Function in the repo that the browser calls directly:
// graph-query and embed are reached from scripts and pg_net, so neither ever
// had to answer a preflight. The app does `functions.invoke` from the Vercel
// origin with `Authorization`, `apikey` and `Content-Type` headers, which makes
// every call a CORS request: the browser first sends an OPTIONS preflight with
// NO Authorization header, and if that is not answered with the allow headers
// (or if the real response lacks Access-Control-Allow-Origin) the browser
// discards the response and the app only ever sees a network error. That is
// exactly what the first live submission on 2026-11-09 looked like.
//
// Why `*` rather than the app's origin: authorisation here never depends on
// the origin. The publishable key ships in every copy of the app, the user JWT
// is the credential, and the real gate is `claim_bug_report()` in Postgres
// under `auth.uid()`. No cookies are involved, so a wildcard grants nothing a
// non-browser client did not already have. It also keeps the local dev server
// (localhost) and any future preview origin working without a redeploy.

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** The browser's preflight. Answered before routing and before any auth check: it carries no JWT. */
export function isPreflight(req: Request): boolean {
  return req.method === "OPTIONS";
}

/** 204 with the allow headers and no body. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/** The CORS headers plus whatever the response needs; the response's own keys win. */
export function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...headers };
}

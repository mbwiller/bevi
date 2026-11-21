// places: see core.ts, which is the whole function. This file only gives it
// the real environment and the real `fetch`, so that test.ts can import
// core.ts without starting a server.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform. GOOGLE_PLACES_API_KEY is ours to set
// (`supabase secrets set`); without it every action answers 503
// `not_configured` and the app's own venue search is unaffected.

import { handle, type Env } from "./core.ts";

function readEnv(): Env | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey, googleKey: Deno.env.get("GOOGLE_PLACES_API_KEY") || null };
}

Deno.serve((req: Request): Promise<Response> => handle(req, { env: readEnv(), fetch }));

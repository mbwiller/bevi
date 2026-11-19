// Signed deployment preflight. Does not claim jobs or contact the image provider.
import { readBounded } from './http.ts';
export async function checkWorker(
  address: string,
  token: string,
  request: typeof fetch = fetch,
): Promise<{ ready: true; generationEnabled: boolean; references: number; claimed: 0 }> {
  const url = new URL(address);
  if (
    url.username || url.password || url.hash || url.search ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  ) {
    throw new Error(
      'Use an HTTPS worker URL, or a local HTTP URL, without credentials or query parameters',
    );
  }
  if (!token.trim()) throw new Error('ICON_WEBHOOK_SECRET required; no service-role fallback');
  url.searchParams.set('mode', 'preflight');
  let res: Response;
  try {
    res = await request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error('Worker preflight transport failed');
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Worker preflight failed (HTTP ${res.status})`);
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBounded(res, 64 * 1024)));
  } catch {
    throw new Error('Invalid worker preflight response');
  }
  if (
    body?.ready !== true || body.claimed !== 0 || typeof body.generationEnabled !== 'boolean' ||
    !Number.isInteger(body.references) || body.references < 3 || body.references > 20
  ) {
    throw new Error('Worker did not return a valid non-generating preflight result');
  }
  return {
    ready: true,
    generationEnabled: body.generationEnabled,
    references: body.references,
    claimed: 0,
  };
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 2 || Deno.args[0] !== '--url') {
      throw new Error('Usage: check.ts --url <worker-url>');
    }
    const result = await checkWorker(Deno.args[1], Deno.env.get('ICON_WEBHOOK_SECRET') ?? '');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Worker preflight failed');
    Deno.exitCode = 1;
  }
}

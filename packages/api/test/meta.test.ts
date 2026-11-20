import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from '@bevi/shared';
import { createMetaApi } from '../src/meta.ts';

// IA-2: `meta.getAppConfig` over `get_app_config()`
// (20261118210313_app_config.sql). These drive a real supabase-js client over
// a scripted `fetch` rather than a stand-in client, because what is being
// pinned is the wire: which request a signed-out caller sends, and what
// postgrest-js makes of the body PostgREST answers with for a function that
// returns a single composite.

const PROJECT_URL = 'https://project.supabase.co';
const PUBLISHABLE_KEY = 'publishable-key-for-tests';

interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
}

type Reply = { status: number; body: unknown } | { reject: Error };

/** A signed-out client: no stored session, so nothing but the publishable key to send. */
function metaOver(reply: Reply) {
  const sent: SentRequest[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers) });
    if ('reject' in reply) throw reply.reject;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return { meta: createMetaApi(client), sent };
}

/** The whole `app_config` row, as `select * from public.app_config` has it. */
function configRow(over: Record<string, unknown> = {}) {
  return {
    id: true,
    min_app_version: '1.2.0',
    min_contract_version: '3.1.0',
    maintenance: true,
    maintenance_message: 'Back by 9pm ET.',
    ios_min_build: 14,
    updated_at: '2026-11-19T12:00:00+00:00',
    ...over,
  };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected a rejection');
}

describe('meta.getAppConfig', () => {
  it('maps the row to AppConfig, and exposes neither ios_min_build nor updated_at', async () => {
    const { meta } = metaOver({ status: 200, body: configRow() });
    expect(await meta.getAppConfig()).toEqual({
      minAppVersion: '1.2.0',
      minContractVersion: '3.1.0',
      maintenance: true,
      maintenanceMessage: 'Back by 9pm ET.',
    });
  });

  it('a null maintenance_message stays null', async () => {
    const { meta } = metaOver({
      status: 200,
      body: configRow({ min_app_version: '0.0.0', min_contract_version: '0.0.0', maintenance: false, maintenance_message: null }),
    });
    expect(await meta.getAppConfig()).toEqual({
      minAppVersion: '0.0.0',
      minContractVersion: '0.0.0',
      maintenance: false,
      maintenanceMessage: null,
    });
  });

  it('is one RPC call carrying only the publishable key: no session is asked for', async () => {
    const { meta, sent } = metaOver({ status: 200, body: configRow() });
    await meta.getAppConfig();
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${PROJECT_URL}/rest/v1/rpc/get_app_config`]);
    expect(sent[0]!.headers.get('apikey')).toBe(PUBLISHABLE_KEY);
    expect(sent[0]!.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE_KEY}`);
  });

  // PostgREST answers a single-composite function with an object. Were the
  // same row ever to arrive as a one-element array (what `returns setof` would
  // send), `.maybeSingle()` unwraps it, so the read does not hinge on which.
  it('reads the same row from a one-element array', async () => {
    const { meta } = metaOver({ status: 200, body: [configRow()] });
    expect((await meta.getAppConfig()).minContractVersion).toBe('3.1.0');
  });

  it.each([
    // `select * from f()` over an empty `app_config`: one row, every column null.
    ['a row of nulls', configRow({ id: null, min_app_version: null, min_contract_version: null, maintenance: null, ios_min_build: null, updated_at: null, maintenance_message: null })],
    ['an empty array', []],
    ['a JSON null', null],
  ])('an empty app_config (%s) is an error, not an invented default', async (_name, body) => {
    const { meta } = metaOver({ status: 200, body });
    const e = await rejection(meta.getAppConfig());
    expect(e.code).toBe('unknown');
    expect(e.message).toBe('get_app_config returned no row');
  });

  it.each([
    // The grant to `anon` gone: PostgREST's permission-denied.
    [{ status: 401, body: { code: '42501', message: 'permission denied for function get_app_config', details: null, hint: null } }, 'unauthorized'],
    // The function gone from the schema cache.
    [{ status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.get_app_config', details: null, hint: null } }, 'unknown'],
    // The project paused or down.
    [{ status: 503, body: { code: 'PGRST002', message: 'Could not query the database for the schema cache', details: null, hint: null } }, 'unknown'],
    // No connection at all: what Node and the browser throw from fetch.
    [{ reject: new TypeError('fetch failed') }, 'network'],
  ] as [Reply, string][])('a failed read (%o) is thrown as ApiError %s', async (reply, code) => {
    const { meta } = metaOver(reply);
    expect((await rejection(meta.getAppConfig())).code).toBe(code);
  });
});

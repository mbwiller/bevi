// The version gate and the maintenance flag (IA-2): one read of the
// `app_config` singleton through `get_app_config()`
// (20261118210313_app_config.sql).
//
// No `requireUserId` here, unlike nearly every other module: the contract
// promises this call works signed out, and the RPC is granted to `anon` for
// that reason -- a client has to be able to read the gate before it can sign
// in. Signed out, supabase-js sends the publishable key as the bearer.
//
// Errors are mapped and thrown like any other read's. Nothing here falls back
// to a default: the app's gate fails open on an error (IM-9), and a made-up
// config would be indistinguishable from a real one.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig, MetaApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapAppConfig, type AppConfigRow } from './mappers';

export function createMetaApi(client: SupabaseClient): MetaApi {
  return {
    async getAppConfig(): Promise<AppConfig> {
      // `get_app_config()` returns one composite (`returns public.app_config`,
      // not `setof`), which PostgREST sends as a JSON object, not an array.
      // `.maybeSingle()` is `profile.checkHandle`'s convention for a one-row
      // RPC and costs nothing here: postgrest-js leaves an object as it is and
      // unwraps a one-element array, so either wire shape reaches the mapper
      // as a row.
      const { data, error } = await client.rpc('get_app_config').maybeSingle();
      if (error) throw mapError(error);
      return mapAppConfig(data as AppConfigRow | null);
    },
  };
}

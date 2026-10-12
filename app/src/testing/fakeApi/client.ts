// What `@/api/client` resolves to under jest (jest.setup.js): the FakeApi instead of Supabase.
import type { BeviApi } from '@bevi/shared';

import type { ApiConfig } from '@/api/config';

import { getFakeApi } from './instance';

export const apiConfig: ApiConfig = { ok: true, url: 'https://fake.invalid', publishableKey: 'sb_publishable_fake' };
export const api: BeviApi = getFakeApi();

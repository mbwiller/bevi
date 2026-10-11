import type { AppConfig, MetaApi } from '@bevi/shared';
import { placeholderAppConfig } from './mappers';

// No versioning/maintenance-flag table or Edge Function exists yet; this
// is a fixed placeholder so the app has something to call during
// development, not a real remote-config read.
export function createMetaApi(): MetaApi {
  return {
    async getAppConfig(): Promise<AppConfig> {
      return placeholderAppConfig();
    },
  };
}

import { isApiError, type Bev, type CreateBevInput, type ValidationErrorDetail } from '@bevi/shared';

/**
 * `bevs.create` rejects with `validation` (`detail.reason = 'asset_not_ready'`) while the photo is
 * still being processed (background removal, ~3 s in the mock). The contract has no way to ask
 * for an asset's status (no `media.get`), so the wizard waits and retries `create` with backoff,
 * showing "Processing photo…", until it goes through or `maxWaitMs` passes.
 */
export const READY_BACKOFF_MS = [1000, 1500, 2000, 3000, 5000] as const;
export const READY_MAX_WAIT_MS = 60_000;

export function isAssetNotReady(error: unknown): boolean {
  if (!isApiError(error) || error.code !== 'validation') return false;
  return (error.detail as ValidationErrorDetail | undefined)?.reason === 'asset_not_ready';
}

/** Photo reasons that waiting can't fix. */
const FINAL_PHOTO_REASONS = new Set(['unknown_asset']);

/**
 * Worth waiting for: `asset_not_ready`, or any other `validation` on `photoAssetId` whose reason
 * isn't a known final one. The real backend's reason string isn't pinned in the contract yet, so
 * an unrecognised photo rejection gets the same 60 s budget before the wizard asks for the photo
 * again.
 */
export function mayBeProcessing(error: unknown): boolean {
  if (isAssetNotReady(error)) return true;
  if (!isApiError(error) || error.code !== 'validation') return false;
  const detail = error.detail as ValidationErrorDetail | undefined;
  return detail?.field === 'photoAssetId' && !FINAL_PHOTO_REASONS.has(detail.reason ?? '');
}

export interface CreateWhenReadyOptions {
  /** Called once, when the first attempt finds the photo still processing. */
  onWaiting?: () => void;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  /** Stop retrying (the wizard was closed). */
  signal?: { aborted: boolean };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function createWhenReady(
  create: (input: CreateBevInput) => Promise<Bev>,
  input: CreateBevInput,
  { onWaiting, sleep = defaultSleep, maxWaitMs = READY_MAX_WAIT_MS, signal }: CreateWhenReadyOptions = {},
): Promise<Bev> {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await create(input);
    } catch (e) {
      if (!mayBeProcessing(e) || waited >= maxWaitMs || signal?.aborted) throw e;
      if (attempt === 0) onWaiting?.();
      const delay = READY_BACKOFF_MS[Math.min(attempt, READY_BACKOFF_MS.length - 1)] ?? READY_BACKOFF_MS[0];
      await sleep(delay);
      waited += delay;
      if (signal?.aborted) throw e;
    }
  }
}

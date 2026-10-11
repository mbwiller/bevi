import { ApiError, type Bev, type CreateBevInput } from '@bevi/shared';

import { createWhenReady, READY_BACKOFF_MS } from '../createWhenReady';
import { fitWithin } from '../photo';

const input = { name: 'X', categoryId: 'soda', priceTier: 1, priceEstimated: false, photoAssetId: 'a' } as CreateBevInput;
const bev = { id: 'bev_1' } as Bev;
const notReady = () => new ApiError('validation', 'The photo is still processing', { field: 'photoAssetId', reason: 'asset_not_ready' });

describe('createWhenReady', () => {
  it('retries with backoff while the photo is processing, then resolves', async () => {
    const create = jest.fn().mockRejectedValueOnce(notReady()).mockRejectedValueOnce(notReady()).mockResolvedValueOnce(bev);
    const sleep = jest.fn(() => Promise.resolve());
    const onWaiting = jest.fn();
    await expect(createWhenReady(create, input, { sleep, onWaiting })).resolves.toBe(bev);
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[READY_BACKOFF_MS[0]], [READY_BACKOFF_MS[1]]]);
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  it('gives up after the max wait and rethrows the last error', async () => {
    const create = jest.fn().mockRejectedValue(notReady());
    const sleep = jest.fn(() => Promise.resolve());
    await expect(createWhenReady(create, input, { sleep, maxWaitMs: 2000 })).rejects.toMatchObject({ code: 'validation', detail: { reason: 'asset_not_ready' } });
    expect(create.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not retry other errors', async () => {
    const conflict = new ApiError('conflict', 'exists', { existingBevId: 'bev_9' });
    const create = jest.fn().mockRejectedValue(conflict);
    await expect(createWhenReady(create, input, { sleep: () => Promise.resolve() })).rejects.toBe(conflict);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('stops when aborted', async () => {
    const signal = { aborted: false };
    const create = jest.fn().mockRejectedValue(notReady());
    const sleep = jest.fn(async () => {
      signal.aborted = true;
    });
    await expect(createWhenReady(create, input, { sleep, signal })).rejects.toMatchObject({ code: 'validation', detail: { reason: 'asset_not_ready' } });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('fitWithin', () => {
  it('scales the long edge down to 1600 and keeps the ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

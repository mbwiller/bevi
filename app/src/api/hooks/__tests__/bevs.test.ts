import { bevIconRefetchInterval, BEV_ICON_POLL_INTERVAL_MS, BEV_ICON_POLL_WINDOW_MS } from '../bevs';

it.each(['pending', 'processing'] as const)('polls %s at the normal interval before the one-minute deadline', (status) => {
  expect(bevIconRefetchInterval({ status }, 0)).toBe(BEV_ICON_POLL_INTERVAL_MS);
  expect(bevIconRefetchInterval({ status }, BEV_ICON_POLL_WINDOW_MS - 1)).toBe(BEV_ICON_POLL_INTERVAL_MS);
});

it.each(['pending', 'processing'] as const)('stops polling %s at the one-minute deadline', (status) => {
  expect(bevIconRefetchInterval({ status }, BEV_ICON_POLL_WINDOW_MS)).toBe(false);
  expect(bevIconRefetchInterval({ status }, BEV_ICON_POLL_WINDOW_MS + 1)).toBe(false);
});

it.each(['none', 'completed', 'failed'] as const)('does not poll terminal %s status', (status) => {
  expect(bevIconRefetchInterval({ status }, 0)).toBe(false);
});

// A failed lookup has no status at all, so this is the case that keying on the status
// alone got wrong: the retry never started and the screen held an empty answer.
it('retries a failed lookup under the same deadline', () => {
  expect(bevIconRefetchInterval({ status: undefined, errored: true }, 0)).toBe(BEV_ICON_POLL_INTERVAL_MS);
  expect(bevIconRefetchInterval({ status: undefined, errored: true }, BEV_ICON_POLL_WINDOW_MS)).toBe(false);
});

it('retries a failed lookup even when the last good answer was terminal', () => {
  expect(bevIconRefetchInterval({ status: 'completed', errored: true }, 0)).toBe(BEV_ICON_POLL_INTERVAL_MS);
});

it('does not poll a settled lookup that has no icon row', () => {
  expect(bevIconRefetchInterval({ status: undefined, errored: false }, 0)).toBe(false);
});

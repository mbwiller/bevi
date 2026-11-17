import { bevIconRefetchInterval, BEV_ICON_POLL_INTERVAL_MS, BEV_ICON_POLL_WINDOW_MS } from '../bevs';

it.each(['pending', 'processing'] as const)('polls %s at the normal interval before the one-minute deadline', (status) => {
  expect(bevIconRefetchInterval(status, 0)).toBe(BEV_ICON_POLL_INTERVAL_MS);
  expect(bevIconRefetchInterval(status, BEV_ICON_POLL_WINDOW_MS - 1)).toBe(BEV_ICON_POLL_INTERVAL_MS);
});

it.each(['pending', 'processing'] as const)('stops polling %s at the one-minute deadline', (status) => {
  expect(bevIconRefetchInterval(status, BEV_ICON_POLL_WINDOW_MS)).toBe(false);
  expect(bevIconRefetchInterval(status, BEV_ICON_POLL_WINDOW_MS + 1)).toBe(false);
});

it.each(['none', 'completed', 'failed'] as const)('does not poll terminal %s status', (status) => {
  expect(bevIconRefetchInterval(status, 0)).toBe(false);
});

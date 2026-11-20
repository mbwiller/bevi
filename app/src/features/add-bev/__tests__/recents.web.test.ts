import { act, renderHook } from '@testing-library/react-native';

import { readRecents, RECENTS_MAX, useRecents } from '../recents.web';

// The web file (localStorage, synchronous), imported by name: jest resolves '../recents' as iOS.

const bev = (n: number) => ({ id: `b-${n}`, name: `Bev ${n}`, brand: null });
const g = globalThis as { localStorage?: unknown };
let store: Map<string, string>;
let saved: unknown;

beforeEach(() => {
  saved = g.localStorage;
  store = new Map();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
afterEach(() => {
  g.localStorage = saved;
});

it('has the stored list on the first render', async () => {
  store.set('bevi.add.recents:u1', JSON.stringify([bev(1)]));
  const { result } = await renderHook(() => useRecents('u1'));
  expect(result.current.recents).toEqual([bev(1)]);
});

it('remembers and forgets in localStorage, one list per account', async () => {
  const { result, rerender } = await renderHook(({ userId }: { userId: string }) => useRecents(userId), {
    initialProps: { userId: 'u1' },
  });
  await act(async () => result.current.remember(bev(1)));
  await act(async () => result.current.remember(bev(2)));
  await act(async () => result.current.remember(bev(1)));
  expect(readRecents('u1').map((r) => r.id)).toEqual(['b-1', 'b-2']);
  expect(result.current.recents.map((r) => r.id)).toEqual(['b-1', 'b-2']);
  await act(async () => result.current.forget('b-2'));
  expect(readRecents('u1').map((r) => r.id)).toEqual(['b-1']);

  await rerender({ userId: 'u2' });
  expect(result.current.recents).toEqual([]);
  expect([...store.keys()]).toEqual(['bevi.add.recents:u1']);

  for (let n = 10; n < 20; n++) await act(async () => result.current.remember(bev(n)));
  expect(readRecents('u2')).toHaveLength(RECENTS_MAX);
});

it('missing or broken storage reads as empty and never throws', async () => {
  store.set('bevi.add.recents:u1', '{not json');
  expect(readRecents('u1')).toEqual([]);
  g.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  const { result } = await renderHook(() => useRecents('u1'));
  await act(async () => result.current.remember(bev(1)));
  expect(result.current.recents.map((r) => r.id)).toEqual(['b-1']);
  g.localStorage = undefined;
  expect(readRecents('u1')).toEqual([]);
});

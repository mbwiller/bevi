import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { loadRecents, RECENTS_MAX, useRecents, type RecentBev } from '../recents';

// Jest resolves as iOS, so this is the native file (AsyncStorage, mocked in jest.setup.js);
// recents.web.test.ts covers the web one.

const bev = (n: number): RecentBev => ({ id: `b-${n}`, name: `Bev ${n}`, brand: null });
const seed = (userId: string, list: RecentBev[]) => AsyncStorage.setItem(`bevi.add.recents:${userId}`, JSON.stringify(list));

// The library's mock is jest.fn()s already, so spying on one would replace its implementation for
// the rest of the file: tests swap implementations and afterEach puts the mock's own back.
const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const realGetItem = getItem.getMockImplementation()!;
const realSetItem = setItem.getMockImplementation()!;

beforeEach(async () => {
  await AsyncStorage.clear();
});
afterEach(() => {
  getItem.mockImplementation(realGetItem);
  setItem.mockImplementation(realSetItem);
});

it('starts empty and fills when the stored list has been read', async () => {
  await seed('u1', [bev(1), bev(2)]);
  const seen: RecentBev[][] = [];
  const { result } = await renderHook(() => {
    const r = useRecents('u1');
    seen.push(r.recents);
    return r;
  });
  await waitFor(() => expect(result.current.recents).toEqual([bev(1), bev(2)]));
  expect(seen[0]).toEqual([]);
});

it('remembers (newest first, no repeats, capped) and forgets, on screen at once and in storage', async () => {
  await seed('u1', [bev(1), bev(2)]);
  const { result } = await renderHook(() => useRecents('u1'));
  await waitFor(() => expect(result.current.recents).toHaveLength(2));

  await act(async () => result.current.remember(bev(2)));
  expect(result.current.recents.map((r) => r.id)).toEqual(['b-2', 'b-1']);
  await act(async () => result.current.remember(bev(3)));
  await waitFor(async () => expect((await loadRecents('u1')).map((r) => r.id)).toEqual(['b-3', 'b-2', 'b-1']));

  await act(async () => result.current.forget('b-2'));
  expect(result.current.recents.map((r) => r.id)).toEqual(['b-3', 'b-1']);
  await waitFor(async () => expect((await loadRecents('u1')).map((r) => r.id)).toEqual(['b-3', 'b-1']));

  for (let n = 10; n < 20; n++) await act(async () => result.current.remember(bev(n)));
  await waitFor(async () => expect(await loadRecents('u1')).toHaveLength(RECENTS_MAX));
  expect(result.current.recents).toHaveLength(RECENTS_MAX);
  expect(result.current.recents[0]!.id).toBe('b-19');
});

it('keeps newer edits visible while older writes finish', async () => {
  await seed('u1', [bev(1)]);
  const { result } = await renderHook(() => useRecents('u1'));
  await waitFor(() => expect(result.current.recents).toEqual([bev(1)]));

  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  setItem
    .mockImplementationOnce(async (key: string, value: string) => {
      await first;
      await realSetItem(key, value);
    })
    .mockImplementationOnce(async (key: string, value: string) => {
      await second;
      await realSetItem(key, value);
    });

  try {
    await act(async () => result.current.remember(bev(2)));
    await act(async () => result.current.forget(bev(1).id));

    await act(async () => releaseFirst());
    expect(result.current.recents).toEqual([bev(2)]);
  } finally {
    await act(async () => {
      releaseFirst();
      releaseSecond();
    });
  }
  expect(await loadRecents('u1')).toEqual([bev(2)]);
});

it("switching accounts never shows the previous account's list, not even for a frame", async () => {
  await seed('u1', [bev(1)]);
  await seed('u2', [bev(2)]);
  const frames: { userId: string | undefined; ids: string[] }[] = [];
  const { result, rerender } = await renderHook(
    ({ userId }: { userId: string | undefined }) => {
      const r = useRecents(userId);
      frames.push({ userId, ids: r.recents.map((b) => b.id) });
      return r;
    },
    { initialProps: { userId: 'u1' as string | undefined } },
  );
  await waitFor(() => expect(result.current.recents.map((r) => r.id)).toEqual(['b-1']));

  await rerender({ userId: 'u2' });
  await waitFor(() => expect(result.current.recents.map((r) => r.id)).toEqual(['b-2']));
  await rerender({ userId: undefined });
  expect(result.current.recents).toEqual([]);

  for (const f of frames) {
    if (f.userId === 'u2') expect(f.ids).not.toContain('b-1');
    if (f.userId === undefined) expect(f.ids).toEqual([]);
  }
});

it("a read that answers after the account changed is not shown for the new account", async () => {
  await seed('u1', [bev(1)]);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  getItem.mockImplementation(async (key: string) => {
    if (key.endsWith(':u1')) await gate;
    return realGetItem(key);
  });
  const { result, rerender } = await renderHook(({ userId }: { userId: string }) => useRecents(userId), {
    initialProps: { userId: 'u1' },
  });
  await rerender({ userId: 'u2' });
  await act(async () => release());
  await waitFor(() => expect(getItem).toHaveBeenCalledWith('bevi.add.recents:u2'));
  expect(result.current.recents).toEqual([]);
});

it('with no user, keeps nothing', async () => {
  const { result } = await renderHook(() => useRecents(undefined));
  await act(async () => result.current.remember(bev(1)));
  expect(result.current.recents).toEqual([]);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});

it('two panels editing at once both land: each edit starts from what is stored', async () => {
  const a = await renderHook(() => useRecents('u1'));
  const b = await renderHook(() => useRecents('u1'));
  await act(async () => {
    a.result.current.remember(bev(1));
    b.result.current.remember(bev(2));
  });
  await waitFor(async () => expect((await loadRecents('u1')).map((r) => r.id)).toEqual(['b-2', 'b-1']));
});

it('storage that fails or holds junk never throws: Recents are just empty, writes are dropped', async () => {
  await AsyncStorage.setItem('bevi.add.recents:u1', '{not json');
  expect(await loadRecents('u1')).toEqual([]);

  getItem.mockRejectedValue(new Error('disk'));
  setItem.mockClear().mockRejectedValue(new Error('full'));
  const { result } = await renderHook(() => useRecents('u1'));
  await act(async () => result.current.remember(bev(1)));
  // Shown for this visit even though it could not be kept.
  expect(result.current.recents.map((r) => r.id)).toEqual(['b-1']);
  await waitFor(() => expect(setItem).toHaveBeenCalled());
});

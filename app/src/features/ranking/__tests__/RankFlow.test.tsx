import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, type BevSummary, type Bucket } from '@bevi/shared';

import { api, mockControls } from '@/api/client';

import { RankFlow } from '../RankFlow';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { canGoBack: () => true, back: mockBack, replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const controls = mockControls!;

// The mock computes its aggregates on the first read after a reset, which can take a moment.
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  mockBack.mockClear();
  mockReplace.mockClear();
});

/** Unranked, non-alcoholic Bevs for demo. */
async function unranked(n: number): Promise<BevSummary[]> {
  const out: BevSummary[] = [];
  for (const q of ['a', 'e', 'o']) {
    const page = await api.bevs.search({ q, limit: 100 });
    for (const b of page.items) {
      if (out.length >= n) return out;
      if (out.some((o) => o.id === b.id)) continue;
      const full = await api.bevs.get(b.id);
      if (!full.myRanking && !['beer', 'wine', 'spirits_cocktails'].includes(b.categoryId)) out.push(b);
    }
  }
  return out;
}

async function renderRank(bevId: string, detailIfRanked = false) {
  await render(
    <QueryClientProvider client={client}>
      <RankFlow bevId={bevId} detailIfRanked={detailIfRanked} />
    </QueryClientProvider>,
  );
}

/** Gut check: pick the bucket, wait for the pour and the list. */
async function chooseBucket(label: string) {
  await screen.findByText('How was it?');
  await fireEvent.press(screen.getByLabelText(label));
}

/** Always prefer the new Bev until placement ends (it goes to the top: insertIndex 0). */
async function answerAllNewBetter(name: string) {
  await screen.findByText('Which was better?', {}, { timeout: 3000 });
  for (;;) {
    const next = await waitFor(() => {
      const el = screen.queryByLabelText(`${name}, candidate`) ?? screen.queryByLabelText('Save');
      if (!el) throw new Error('waiting for the next step');
      return el;
    });
    if (screen.queryByLabelText('Save')) return;
    await fireEvent.press(next);
  }
}

it('gut check → comparisons → note → submit with expectedBucketSize → result', async () => {
  const [bev] = await unranked(1);
  const loved = await api.rankings.listBucket('LOVED');
  expect(loved.length).toBeGreaterThan(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');

  await renderRank(bev!.id);
  await chooseBucket('Loved it');
  await answerAllNewBetter(bev!.name);

  await fireEvent.changeText(screen.getByLabelText('Note'), 'Crisp and bright');
  await fireEvent.press(screen.getByLabelText('Save'));

  await screen.findByText('Done');
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0]![0]).toMatchObject({
    bevId: bev!.id,
    bucket: 'LOVED' satisfies Bucket,
    insertIndex: 0,
    expectedBucketSize: loved.length,
    note: 'Crisp and bright',
  });
  expect(submit.mock.calls[0]![0].comparisons.length).toBeGreaterThan(0);
  expect(screen.getByText(new RegExp(`^#1 of ${loved.length + 1} in Loved · \\d+\\.\\d$`))).toBeTruthy();
});

it('an empty bucket skips comparisons: "First one in …"', async () => {
  const [bev] = await unranked(1);
  controls.emptyUser();
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await renderRank(bev!.id);
  await chooseBucket('It was fine');
  await screen.findByText('First one in Fine', {}, { timeout: 3000 });
  await fireEvent.press(screen.getByLabelText('Skip'));
  await screen.findByText(/^#1 of 1 in Fine · /);
  expect(submit.mock.calls[0]![0]).toEqual({ bevId: bev!.id, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
});

it('a conflict refetches the bucket and restarts placement', async () => {
  const [bev, other] = await unranked(2);
  const loved = await api.rankings.listBucket('LOVED');
  const submit = jest.spyOn(api.rankings, 'submitRanking');

  await renderRank(bev!.id);
  await chooseBucket('Loved it');
  await answerAllNewBetter(bev!.name);

  // Meanwhile, another device adds a Bev to Loved.
  await api.rankings.submitRanking({ bevId: other!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });
  submit.mockClear();

  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText("Your list changed, let's redo this one");
  await answerAllNewBetter(bev!.name);
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');

  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[0]![0].expectedBucketSize).toBe(loved.length);
  expect(submit.mock.calls[1]![0].expectedBucketSize).toBe(loved.length + 1);
  expect(screen.getByText(new RegExp(`^#1 of ${loved.length + 2} in Loved`))).toBeTruthy();
});

it('offline on save keeps the placement and retries', async () => {
  const [bev] = await unranked(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await renderRank(bev!.id);
  await chooseBucket("Didn't like it");
  await waitFor(() => expect(screen.queryByText('How was it?')).toBeNull(), { timeout: 3000 });
  if (!screen.queryByText('Add a note') && !screen.queryByText(/^First one in/)) await answerAllNewBetter(bev!.name);

  controls.failNext('network', 'rankings.submitRanking');
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText("You're offline");
  await fireEvent.press(screen.getByLabelText('Retry'));
  await screen.findByText('Done');
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
});

it('re-ranks a Bev already ranked with rerankBev, excluding it from expectedBucketSize', async () => {
  const loved = await api.rankings.listBucket('LOVED');
  const target = loved[loved.length - 1]!;
  const { name } = await api.bevs.get(target);
  const rerank = jest.spyOn(api.rankings, 'rerankBev');
  await renderRank(target);
  await chooseBucket('Loved it');
  await answerAllNewBetter(name);
  await fireEvent.press(screen.getByLabelText('Skip'));
  await screen.findByText('Done');
  expect(rerank.mock.calls[0]![0]).toMatchObject({ bevId: target, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length - 1 });
  expect(screen.getByText(new RegExp(`^#1 of ${loved.length} in Loved`))).toBeTruthy();
});

it('closing mid-flow asks before discarding', async () => {
  const [bev] = await unranked(1);
  await renderRank(bev!.id);
  await chooseBucket('Loved it');
  await screen.findByText('Which was better?', {}, { timeout: 3000 });
  await fireEvent.press(screen.getByLabelText('Discard ranking'));
  expect(await screen.findByText('Discard this ranking?')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Keep ranking'));
  await waitFor(() => expect(screen.queryByText('Discard this ranking?')).toBeNull());
  expect(screen.getByText('Which was better?')).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Discard ranking'));
  await fireEvent.press(await screen.findByLabelText('Discard'));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('shows "Not available" for an age-restricted Bev', async () => {
  controls.signInAs('theo');
  jest.spyOn(api.bevs, 'get').mockRejectedValue(new ApiError('age_restricted', 'Not available'));
  await renderRank('any-bev');
  expect(await screen.findByText('Not available')).toBeTruthy();
  expect(screen.queryByLabelText('Retry')).toBeNull();
});

/** Runs to the note step in Loved (always preferring the new Bev). */
async function toNote(bev: BevSummary) {
  await renderRank(bev.id);
  await chooseBucket('Loved it');
  await answerAllNewBetter(bev.name);
}

it('a conflict without detail on a Bev ranked elsewhere switches to rerankBev', async () => {
  const [bev] = await unranked(1);
  const loved = await api.rankings.listBucket('LOVED');
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  const rerank = jest.spyOn(api.rankings, 'rerankBev');
  await toNote(bev!);

  // Another device ranks this Bev in Fine; the server answers a bare conflict (no detail).
  const fine = await api.rankings.listBucket('FINE');
  await api.rankings.submitRanking({ bevId: bev!.id, bucket: 'FINE', insertIndex: 0, expectedBucketSize: fine.length, comparisons: [] });
  submit.mockClear();
  submit.mockRejectedValueOnce(new ApiError('conflict', 'Already ranked'));

  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText("Your list changed, let's redo this one");
  await answerAllNewBetter(bev!.name);
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');
  expect(submit).toHaveBeenCalledTimes(1);
  expect(rerank).toHaveBeenCalledTimes(1);
  // The Bev is in Fine, so Loved's size is unchanged.
  expect(rerank.mock.calls[0]![0]).toMatchObject({ bevId: bev!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length });
});

it('a conflict whose bucket refetch fails shows the error instead of restarting on the stale list', async () => {
  const [bev] = await unranked(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNote(bev!);
  submit.mockRejectedValueOnce(new ApiError('conflict', 'Your list changed'));
  jest.spyOn(api.rankings, 'listBucket').mockRejectedValue(new ApiError('network', 'offline'));

  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText("You're offline")).toBeTruthy();
  expect(screen.queryByText("Your list changed, let's redo this one")).toBeNull();
  expect(screen.getByText('Add a note')).toBeTruthy();
});

it('a validation error on the note shows on the field and keeps the placement', async () => {
  const [bev] = await unranked(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNote(bev!);
  submit.mockRejectedValueOnce(new ApiError('validation', 'Notes are up to 140 characters', { field: 'note' }));
  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText('Notes are up to 140 characters')).toBeTruthy();
  expect(screen.getByText('Add a note')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
});

it('any other validation error restarts placement on a fresh list', async () => {
  const [bev] = await unranked(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await toNote(bev!);
  submit.mockRejectedValueOnce(new ApiError('validation', 'insertIndex out of range', { field: 'insertIndex' }));
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText("That didn't go through, let's redo this one");
  expect(warn).toHaveBeenCalled();
  expect(screen.getByText('Which was better?')).toBeTruthy();
});

it('entered from a search tap (entry=search), an already-ranked Bev opens its detail', async () => {
  const [target] = await api.rankings.listBucket('LOVED');
  await renderRank(target!, true);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/bev/[id]', params: { id: target } }));
  expect(screen.queryByText('How was it?')).toBeNull();
});

it('entered from a search tap, an unranked Bev goes straight to the gut check', async () => {
  const [bev] = await unranked(1);
  await renderRank(bev!.id, true);
  expect(await screen.findByText('How was it?')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

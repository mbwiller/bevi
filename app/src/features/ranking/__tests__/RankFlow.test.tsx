import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { maxAnchoredComparisons, maxComparisons, storedScore } from '@bevi/ranking';
import { ApiError, type BevSummary, type Bucket, type SubmitRankingResult } from '@bevi/shared';

import { api } from '@/api/client';
import { formatScore } from '@/lib/format';
import { controls } from '@/testing/fakeApi';

import { RankFlow } from '../RankFlow';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { canGoBack: () => true, back: mockBack, replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
// Reduce Motion is off unless a test turns it on (then the score shows without the count-up).
let mockReduced = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => mockReduced,
}));

// The FakeApi computes its aggregates on the first read after a reset, which can take a moment.
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  mockBack.mockClear();
  mockReplace.mockClear();
});

/** Unranked, non-alcoholic Bevs for the test user. */
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
  if (!screen.queryByText(/^#\d+ of \d+ in Didn't like$/) && !screen.queryByText(/^First one in/)) await answerAllNewBetter(bev!.name);

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
  controls.signInAs('minor_user');
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
  // Both list reads fail (listBucketBevs falls back to listBucket since M-21's anchored placement).
  jest.spyOn(api.rankings, 'listBucketBevs').mockRejectedValue(new ApiError('network', 'offline'));
  jest.spyOn(api.rankings, 'listBucket').mockRejectedValue(new ApiError('network', 'offline'));

  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText("You're offline")).toBeTruthy();
  expect(screen.queryByText("Your list changed, let's redo this one")).toBeNull();
  expect(screen.getByText(/^#1 of \d+ in Loved$/)).toBeTruthy();
});

it('a validation error on the note shows on the field and keeps the placement', async () => {
  const [bev] = await unranked(1);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNote(bev!);
  submit.mockRejectedValueOnce(new ApiError('validation', 'Notes are up to 140 characters', { field: 'note' }));
  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText('Notes are up to 140 characters')).toBeTruthy();
  expect(screen.getByText(/^#1 of \d+ in Loved$/)).toBeTruthy();
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

describe('the score on the note step (Reduce Motion: no count-up)', () => {
  beforeEach(() => {
    mockReduced = true;
  });
  afterEach(() => {
    mockReduced = false;
  });

  /** The note step shows the score and the place before anything is typed. */
  function expectRevealed(score: number, line: string) {
    expect(screen.getByLabelText(`Score ${formatScore(score)}`)).toBeTruthy();
    expect(screen.getByText(formatScore(score))).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByLabelText('Note').props.value).toBe('');
  }

  /** The score the save came back with. */
  async function savedScore(spy: jest.SpyInstance): Promise<number> {
    const res = (await spy.mock.results[spy.mock.results.length - 1]!.value) as SubmitRankingResult;
    return res.ranking.score;
  }

  it('a new ranking: the local storedScore shows, and is the score saved', async () => {
    const [bev] = await unranked(1);
    const loved = await api.rankings.listBucket('LOVED');
    const submit = jest.spyOn(api.rankings, 'submitRanking');
    await toNote(bev!);

    const local = storedScore(0, loved.length + 1, 'LOVED');
    expectRevealed(local, `#1 of ${loved.length + 1} in Loved`);

    await fireEvent.press(screen.getByLabelText('Skip'));
    await screen.findByText('Done');
    expect(submit.mock.calls[0]![0]).toMatchObject({ insertIndex: 0, expectedBucketSize: loved.length });
    expect(await savedScore(submit)).toBe(local);
  });

  it('a re-rank: the score for the new place shows, and is the score saved', async () => {
    const loved = await api.rankings.listBucket('LOVED');
    const target = loved[loved.length - 1]!;
    const { name } = await api.bevs.get(target);
    const rerank = jest.spyOn(api.rankings, 'rerankBev');
    await renderRank(target);
    await chooseBucket('Loved it');
    await answerAllNewBetter(name);

    // The Bev leaves its old place: the bucket is the same size, with it at the top.
    const local = storedScore(0, loved.length, 'LOVED');
    expectRevealed(local, `#1 of ${loved.length} in Loved`);

    await fireEvent.press(screen.getByLabelText('Skip'));
    await screen.findByText('Done');
    expect(rerank.mock.calls[0]![0]).toMatchObject({ insertIndex: 0, expectedBucketSize: loved.length - 1 });
    expect(await savedScore(rerank)).toBe(local);
  });

  it('the first Bev in a bucket: "First one in Fine" with its score, the score saved', async () => {
    const [bev] = await unranked(1);
    controls.emptyUser();
    const submit = jest.spyOn(api.rankings, 'submitRanking');
    await renderRank(bev!.id);
    await chooseBucket('It was fine');
    await screen.findByText('First one in Fine', {}, { timeout: 3000 });

    const local = storedScore(0, 1, 'FINE');
    expectRevealed(local, 'First one in Fine');
    expect(screen.queryByText('#1 of 1 in Fine')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Skip'));
    await screen.findByText('Done');
    expect(await savedScore(submit)).toBe(local);
  });

  it('after Undo and a different answer, the score is recomputed for the new place', async () => {
    const [bev] = await unranked(1);
    const loved = await api.rankings.listBucket('LOVED');
    const submit = jest.spyOn(api.rankings, 'submitRanking');
    await toNote(bev!);
    expectRevealed(storedScore(0, loved.length + 1, 'LOVED'), `#1 of ${loved.length + 1} in Loved`);

    // Take back the last "new is better" (against the current #1) and say the #1 was better instead.
    await fireEvent.press(screen.getByLabelText('Undo'));
    await screen.findByText('Which was better?');
    await fireEvent.press(screen.getByLabelText(/, currently #1 in Loved$/));
    await screen.findByLabelText('Save');

    const local = storedScore(1, loved.length + 1, 'LOVED');
    expectRevealed(local, `#2 of ${loved.length + 1} in Loved`);

    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText('Done');
    expect(submit.mock.calls[0]![0]).toMatchObject({ insertIndex: 1, expectedBucketSize: loved.length });
    expect(await savedScore(submit)).toBe(local);
  });

  it('after a conflict restart, the score is recomputed on the fresh list', async () => {
    const [bev, other] = await unranked(2);
    const loved = await api.rankings.listBucket('LOVED');
    const submit = jest.spyOn(api.rankings, 'submitRanking');
    await toNote(bev!);
    expectRevealed(storedScore(0, loved.length + 1, 'LOVED'), `#1 of ${loved.length + 1} in Loved`);

    await api.rankings.submitRanking({ bevId: other!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });
    submit.mockClear();
    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText("Your list changed, let's redo this one");
    await answerAllNewBetter(bev!.name);

    const local = storedScore(0, loved.length + 2, 'LOVED');
    expectRevealed(local, `#1 of ${loved.length + 2} in Loved`);

    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText('Done');
    expect(await savedScore(submit)).toBe(local);
  });
});

describe('anchored placement (M-21): like-for-like questions first', () => {
  // The tester's Loved list mixes coffee leaves with three sodas; #8 is A&W Root Beer (soda / root_beer).
  // Plain binary search over its 9 Bevs asks #5 first (Death Wish, a cold brew).
  const ROOT_BEER = 'barqs-root-beer'; // soda / root_beer, unranked
  const COLD_BREW = 'chameleon-cold-brew-black'; // coffee / cold_brew, unranked: anchors #1, #2, #5
  const DIET_ROOT_BEER = 'aw-diet-root-beer'; // diet_soda: no shared root, one stored edge to A&W Root Beer

  async function nameOf(id: string) {
    return (await api.bevs.get(id)).name;
  }

  /** The incumbent on screen, by its card label. */
  async function expectAskedAbout(id: string, rank: number) {
    const name = await nameOf(id);
    expect(await screen.findByLabelText(`${name}, currently #${rank} in Loved`, {}, { timeout: 3000 })).toBeTruthy();
  }

  async function startIn(bevId: string) {
    expect((await api.bevs.get(bevId)).myRanking).toBeFalsy();
    await renderRank(bevId);
    await chooseBucket('Loved it');
    await screen.findByText('Which was better?', {}, { timeout: 3000 });
  }

  it('a new Bev whose leaf matches a bucket Bev is asked about that Bev first', async () => {
    const loved = await api.rankings.listBucket('LOVED');
    expect(loved[7]).toBe('aw-root-beer');
    await startIn(ROOT_BEER);
    await expectAskedAbout('aw-root-beer', 8);
  });

  it('the progress dots follow the anchored bound, which can exceed the plain one', async () => {
    const loved = await api.rankings.listBucket('LOVED');
    await startIn(COLD_BREW);
    // Anchors at #1, #2, #5: the first question is #2.
    await expectAskedAbout('stok-cold-brew-not-too-sweet', 2);
    const anchored = maxAnchoredComparisons(loved.length, [0, 1, 4]);
    expect(anchored).toBeGreaterThan(maxComparisons(loved.length));
    expect(screen.getAllByTestId('progress-dot')).toHaveLength(anchored);
    expect(screen.getByLabelText(`Comparison 1 of up to ${anchored}`)).toBeTruthy();
  });

  it('a re-rank anchors on the other Bevs of its leaf, never on itself', async () => {
    const target = 'death-wish-coffee-rtd-black'; // #5 in Loved, a cold brew like #1 and #2
    const name = await nameOf(target);
    const rerank = jest.spyOn(api.rankings, 'rerankBev');
    await renderRank(target);
    await chooseBucket('Loved it');
    // Without it the list is 8 long; the other cold brews are #1 and #2, and #2 is asked first.
    await expectAskedAbout('stok-cold-brew-not-too-sweet', 2);
    await answerAllNewBetter(name);
    await fireEvent.press(screen.getByLabelText('Skip'));
    await screen.findByText('Done');
    expect(rerank.mock.calls[0]![0]).toMatchObject({ bevId: target, insertIndex: 0, expectedBucketSize: 8 });
  });

  it('leaves fail: the plain search, with the same first question as before anchoring', async () => {
    jest.spyOn(api.bevs, 'leaves').mockRejectedValue(new ApiError('network', 'offline'));
    await startIn(ROOT_BEER);
    await expectAskedAbout('death-wish-coffee-rtd-black', 5);
    expect(screen.getAllByTestId('progress-dot')).toHaveLength(maxComparisons(9));
  });

  it('listBucketBevs fails: the list comes from listBucket, the plain search', async () => {
    jest.spyOn(api.rankings, 'listBucketBevs').mockRejectedValue(new ApiError('unknown', 'boom'));
    const listBucket = jest.spyOn(api.rankings, 'listBucket');
    const leaves = jest.spyOn(api.bevs, 'leaves');
    await startIn(ROOT_BEER);
    await expectAskedAbout('death-wish-coffee-rtd-black', 5);
    expect(listBucket).toHaveBeenCalledWith('LOVED');
    expect(leaves).not.toHaveBeenCalled();
  });

  it('similarities fail: the edge tier is lost, but the flow still starts', async () => {
    // With the edge, A&W Root Beer anchors a new Diet Root Beer; without it, nothing does.
    jest.spyOn(api.bevs, 'similarities').mockRejectedValue(new ApiError('network', 'offline'));
    await startIn(DIET_ROOT_BEER);
    await expectAskedAbout('death-wish-coffee-rtd-black', 5);
  });

  it('similarities answer: a stored edge anchors across roots', async () => {
    await startIn(DIET_ROOT_BEER);
    await expectAskedAbout('aw-root-beer', 8);
  });

  it('similarities hang: the first question comes after the timeout, on taxonomy tiers', async () => {
    jest.spyOn(api.bevs, 'similarities').mockReturnValue(new Promise(() => {}));
    await startIn(ROOT_BEER);
    await expectAskedAbout('aw-root-beer', 8);
  });

  it('undo crosses from the gap back into the anchor phase', async () => {
    await startIn(ROOT_BEER);
    await expectAskedAbout('aw-root-beer', 8);
    // A&W was better: the only gap left is below it, so #9 is next.
    await fireEvent.press(screen.getByLabelText(`${await nameOf('aw-root-beer')}, currently #8 in Loved`));
    await expectAskedAbout('mexican-coca-cola', 9);
    await fireEvent.press(screen.getByLabelText('Undo'));
    await expectAskedAbout('aw-root-beer', 8);
    // The new Bev was better this time: the search moves to the gap above, #1 to #7.
    await fireEvent.press(screen.getByLabelText(`${await nameOf(ROOT_BEER)}, candidate`));
    await expectAskedAbout('faygo-rock-and-rye', 4);
  });
});

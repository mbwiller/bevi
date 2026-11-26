import path from 'path';

import { selectStarterSet } from '@bevi/ranking';
import { ApiError, type CategoryId } from '@bevi/shared';
import { configure, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { ALCOHOLIC_CATEGORY_IDS, starterSeed } from '../selection';

const APP_DIR = path.resolve(__dirname, '../../../../app');

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(60000);

/** A new account mid-onboarding: the test user, emptied (no rankings, no birthdate, not onboarded). */
async function open() {
  controls.signInAs('tester');
  controls.emptyUser();
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });
  await result;
  return () => result.getPathname();
}

/** The 10 the screen should show: selectStarterSet seeded by the user id, alcohol excluded, led by `picks`. */
async function expectedSet(picks: CategoryId[] = []): Promise<{ id: string; name: string; categoryId: CategoryId }[]> {
  const me = await api.profile.getMe();
  const candidates = await api.bevs.getStarterCandidates();
  const ids = selectStarterSet(candidates, { seed: me.id, excludeCategoryIds: [...ALCOHOLIC_CATEGORY_IDS], picks });
  return ids.map((id) => candidates.find((c) => c.id === id)!);
}

const doneButton = () => screen.getByRole('button', { name: 'Done' });

/** "Haven't had it" on the Bev on screen (Yes and No wait for its details). */
async function skip(name: string) {
  await screen.findByRole('header', { name });
  await waitFor(() => expect(screen.getByRole('button', { name: "Haven't had it" })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: "Haven't had it" }));
}

async function start() {
  await fireEvent.press(await screen.findByRole('button', { name: 'Start' }));
}

/** Rank the Bev on screen into an empty bucket: no comparisons, straight to "Placed". */
async function rankFirstIn(bucketLabel: string, name: string) {
  await screen.findByRole('header', { name });
  await waitFor(() => expect(screen.getByRole('button', { name: "I've had it" })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: "I've had it" }));
  await screen.findByText('How was it?');
  await fireEvent.press(screen.getByLabelText(bucketLabel));
  await screen.findByText(/Placed\. Keep going\./);
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

it('shows the selectStarterSet picks, seeded by the user id with alcohol excluded', async () => {
  await open();
  const set = await expectedSet();
  expect(set).toHaveLength(10);
  await screen.findByText("Rank a few Bevs you've had");
  expect(screen.getByText(/^We'll show you 10 popular Bevs\./)).toBeTruthy();
  await start();
  expect(await screen.findByRole('header', { name: set[0]!.name })).toBeTruthy();
  expect(screen.getByText('1 of 10')).toBeTruthy();
  expect(screen.getByText('Rank at least 3 so we can learn your taste')).toBeTruthy();
});

it("with saved go-tos, the set leads with the first pick's category and the intro says so", async () => {
  controls.signInAs('tester');
  controls.emptyUser();
  // A first pick the shared core doesn't already fill, so it has a Bev of its own to lead with.
  const core = (await expectedSet()).slice(0, 3).map((b) => b.categoryId);
  const first = (['tea', 'boba', 'coffee', 'juice', 'water'] as CategoryId[]).find((c) => !core.includes(c))!;
  const picks: CategoryId[] = [first, 'sports'];
  await api.profile.setCategoryPicks(picks);
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });

  const set = await expectedSet(picks);
  expect(set[0]!.categoryId).toBe(first);
  expect(set.map((b) => b.id)).not.toEqual((await expectedSet()).map((b) => b.id));
  expect(await screen.findByText(/^We'll show you 10 Bevs, starting with your go-tos\. Rank the ones/)).toBeTruthy();
  await start();
  expect(await screen.findByRole('header', { name: set[0]!.name })).toBeTruthy();
  await skip(set[0]!.name);
  expect(await screen.findByRole('header', { name: set[1]!.name })).toBeTruthy();
});

it('a failed load of the go-tos blocks with Retry, then the set is chosen with them', async () => {
  controls.signInAs('tester');
  controls.emptyUser();
  await api.profile.setCategoryPicks(['juice']);
  controls.failNext('unknown', 'profile.getCategoryPicks');
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByText(/^We'll show you 10 Bevs, starting with your go-tos\./)).toBeTruthy();
  const set = await expectedSet(['juice']);
  await start();
  expect(await screen.findByRole('header', { name: set[0]!.name })).toBeTruthy();
});

it('skip moves on without ranking', async () => {
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await open();
  const set = await expectedSet();
  await start();
  await skip(set[0]!.name);
  expect(await screen.findByRole('header', { name: set[1]!.name })).toBeTruthy();
  expect(screen.getByText('2 of 10')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
  expect(doneButton()).toBeDisabled();
});

it('ranking 3 turns Done on; finishing marks the profile onboarded and lands on the feed', async () => {
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  const updateMe = jest.spyOn(api.profile, 'updateMe');
  const complete = jest.spyOn(useSession.getState(), 'completeOnboarding');
  const pathname = await open();
  const set = await expectedSet();
  await start();

  await rankFirstIn('Loved it', set[0]!.name);
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await skip(set[1]!.name);
  await rankFirstIn('It was okay', set[2]!.name);
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('header', { name: set[3]!.name });
  expect(screen.getByText('Rank 1 more so we can learn your taste')).toBeTruthy();
  expect(doneButton()).toBeDisabled();

  await rankFirstIn('Not for me', set[3]!.name);
  // Counted at once: Done is on the "Placed" screen before the rankings refetch.
  expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  expect(submit).toHaveBeenCalledTimes(3);
  expect(submit.mock.calls[0]![0]).toEqual({ bevId: set[0]!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('header', { name: set[4]!.name });
  await waitFor(() => expect(doneButton()).toBeEnabled());

  await fireEvent.press(doneButton());
  expect(await screen.findByText('You ranked 3 Bevs')).toBeTruthy();
  expect(screen.getByText(new RegExp(`^Your top: ${set[0]!.name} \\d+\\.\\d$`))).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Go to your feed' }));

  await screen.findAllByText('Your feed');
  expect(updateMe).toHaveBeenCalledWith({ onboarded: true });
  expect(complete).toHaveBeenCalled();
  expect(useSession.getState().status).toBe('ready');
  expect(pathname()).toBe('/feed');
  expect((await api.profile.getMe()).onboarded).toBe(true);
  // DELIVERABLE-44: the three starter rankings are in the user's list, and none of them is a post.
  const me = await api.profile.getMe();
  expect((await api.rankings.listMine()).items).toHaveLength(3);
  expect((await api.feed.listUser(me.id)).items).toEqual([]);
});

it('runs a comparison when the bucket already has a Bev', async () => {
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await open();
  const set = await expectedSet();
  await start();
  await rankFirstIn('Loved it', set[0]!.name);
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await rankAs('Loved it', set[1]!.name);
  await screen.findByText('Which was better?');
  await fireEvent.press(await screen.findByLabelText(`${set[1]!.name}, candidate`));
  await screen.findByText(/^#1 of 2 in Loved · /);
  expect(submit.mock.calls[1]![0]).toMatchObject({ bevId: set[1]!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 1 });
});

it('running out before 3 offers more starters', async () => {
  await open();
  const set = await expectedSet();
  await start();
  for (const b of set) {
    await skip(b.name);
  }
  await screen.findByText("That's all of these");
  await fireEvent.press(screen.getByRole('button', { name: 'Show me more' }));
  expect(await screen.findByText(/^11 of \d+$/)).toBeTruthy();
});

it("'Show me more' passes the go-tos too: the next round leads with the first pick's category", async () => {
  controls.signInAs('tester');
  controls.emptyUser();
  const me = await api.profile.getMe();
  const candidates = await api.bevs.getStarterCandidates();
  const categoryOf = (id: string) => candidates.find((c) => c.id === id)!.categoryId;
  const nameOf = (id: string) => candidates.find((c) => c.id === id)!.name;
  /** Round `n` as the screen picks it: selectStarterSet over the starters not shown yet. */
  const round = (picks: CategoryId[], n: number, seen: ReadonlySet<string>) =>
    selectStarterSet(
      candidates.filter((c) => !seen.has(c.id)),
      { seed: starterSeed(me.id, n), excludeCategoryIds: [...ALCOHOLIC_CATEGORY_IDS], picks },
    );
  // A first pick that still has starters left for round 2 and leads it only because it is passed:
  // without the picks, round 2 would start with a different Bev.
  let pick: CategoryId | undefined;
  let first: string[] = [];
  let next: string[] = [];
  for (const p of ['tea', 'boba', 'coffee', 'juice', 'water', 'energy', 'sports', 'smoothie'] as CategoryId[]) {
    const r0 = round([p], 0, new Set());
    const r1 = round([p], 1, new Set(r0));
    if (r1.length > 0 && categoryOf(r1[0]!) === p && r1[0] !== round([], 1, new Set(r0))[0]) {
      [pick, first, next] = [p, r0, r1];
      break;
    }
  }
  expect(pick).toBeDefined();
  await api.profile.setCategoryPicks([pick!]);
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });

  await start();
  for (const id of first) await skip(nameOf(id));
  await screen.findByText("That's all of these");
  await fireEvent.press(screen.getByRole('button', { name: 'Show me more' }));
  expect(await screen.findByRole('header', { name: nameOf(next[0]!) })).toBeTruthy();
  expect(screen.getByText(`11 of ${first.length + next.length}`)).toBeTruthy();
});

it('a failed candidates call shows Retry', async () => {
  controls.signInAs('tester');
  controls.emptyUser();
  controls.failNext('unknown', 'bevs.getStarterCandidates');
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy();
});

/** Yes on the Bev on screen, then a bucket. */
async function rankAs(bucketLabel: string, name: string) {
  await screen.findByRole('header', { name });
  await waitFor(() => expect(screen.getByRole('button', { name: "I've had it" })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: "I've had it" }));
  await screen.findByText('How was it?');
  await fireEvent.press(screen.getByLabelText(bucketLabel));
}

it('a bare conflict (no detail) on a Bev ranked elsewhere moves on', async () => {
  await open();
  const set = await expectedSet();
  const real = api.rankings.submitRanking.bind(api.rankings);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  // Another device ranks it first; the real API answers a conflict with no detail.
  submit.mockImplementationOnce(async (input) => {
    await real(input);
    throw new ApiError('conflict', 'Already ranked');
  });
  await start();
  await rankAs('Loved it', set[0]!.name);
  expect(await screen.findByRole('header', { name: set[1]!.name })).toBeTruthy();
  expect(submit).toHaveBeenCalledTimes(1);
});

it('a server that keeps answering conflict re-saves once, then shows Retry', async () => {
  await open();
  const set = await expectedSet();
  const submit = jest.spyOn(api.rankings, 'submitRanking').mockRejectedValue(new ApiError('conflict', 'Your list changed'));
  await start();
  await rankAs('Loved it', set[0]!.name);
  expect(await screen.findByText("That didn't save")).toBeTruthy();
  expect(submit).toHaveBeenCalledTimes(2);
  submit.mockRestore();
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText(/Placed\. Keep going\./)).toBeTruthy();
});

it('a conflict whose bucket refetch fails shows the error instead of restarting on the stale list', async () => {
  await open();
  const set = await expectedSet();
  const submit = jest.spyOn(api.rankings, 'submitRanking').mockRejectedValueOnce(new ApiError('conflict', 'Your list changed'));
  const realList = api.rankings.listBucket.bind(api.rankings);
  const list = jest.spyOn(api.rankings, 'listBucket');
  // The first read (placement) works; the reload after the conflict fails.
  list.mockImplementationOnce(realList).mockRejectedValue(new ApiError('unknown', 'Could not load'));
  await start();
  await rankAs('Loved it', set[0]!.name);
  expect(await screen.findByText("That didn't save")).toBeTruthy();
  expect(submit).toHaveBeenCalledTimes(1);
});

it('a failed rankings load shows Retry', async () => {
  controls.signInAs('tester');
  controls.emptyUser();
  controls.failNext('unknown', 'rankings.listMine');
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/starter' });
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy();
});

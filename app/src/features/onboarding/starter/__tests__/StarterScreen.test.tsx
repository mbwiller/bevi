import path from 'path';

import { selectStarterSet } from '@bevi/ranking';
import { ApiError } from '@bevi/shared';
import { configure, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { ALCOHOLIC_CATEGORY_IDS } from '../selection';

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

/** The 10 the screen should show: selectStarterSet seeded by the user id, alcohol excluded. */
async function expectedSet(): Promise<{ id: string; name: string }[]> {
  const me = await api.profile.getMe();
  const candidates = await api.bevs.getStarterCandidates();
  const ids = selectStarterSet(candidates, { seed: me.id, excludeCategoryIds: [...ALCOHOLIC_CATEGORY_IDS] });
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
  await rankFirstIn('It was fine', set[2]!.name);
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('header', { name: set[3]!.name });
  expect(screen.getByText('Rank 1 more so we can learn your taste')).toBeTruthy();
  expect(doneButton()).toBeDisabled();

  await rankFirstIn("Didn't like it", set[3]!.name);
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

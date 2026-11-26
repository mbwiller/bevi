import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { api } from '@/api/client';
import PostNotificationsRoute from '@/app/settings/post-notifications';
import { useSession } from '@/state/session';
import { controls, FRIEND, ME, userIdFor } from '@/testing/fakeApi';

import { personSwitchLabel, POST_NOTIFICATIONS_CAPTION, POST_PEOPLE_EMPTY_TITLE } from '../PostNotificationsScreen';

let mockAvailable = true;
jest.mock('@/features/notifications/push/availability', () => ({ pushAvailable: () => mockAvailable }));

const meId = userIdFor(ME.handle);
const friendId = userIdFor(FRIEND.handle);
let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

function Stub() {
  return <Text>People stub</Text>;
}

async function open() {
  const result = renderRouter(
    { _layout: Layout, 'settings/post-notifications': PostNotificationsRoute, '(tabs)/people/index': Stub },
    { initialUrl: '/settings/post-notifications' },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

async function idle() {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  await act(() => jest.advanceTimersByTimeAsync(20));
}

const personSwitch = (handle: string) => screen.getByRole('switch', { name: personSwitchLabel(handle) });
const listedHandles = () => screen.queryAllByRole('switch').map((s) => (s.props.accessibilityLabel as string).replace('Post notifications for ', ''));
async function flip(handle: string) {
  await fireEvent(personSwitch(handle), 'valueChange', !personSwitch(handle).props.value);
  await idle();
}

/** As `handle`: rank a starter Bev they have not ranked (a NEW post). Returns its Bev id. */
async function rankSomethingNew(handle: string) {
  controls.signInAs(handle);
  const mine = new Set((await api.rankings.listMine({ page: { limit: 100 } })).items.map((r) => r.bev.id));
  const bev = (await api.bevs.getStarterCandidates()).find((b) => !mine.has(b.id))!;
  const ids = await api.rankings.listBucket('LOVED');
  await api.rankings.submitRanking({ bevId: bev.id, bucket: 'LOVED', insertIndex: ids.length, expectedBucketSize: ids.length, comparisons: [] });
  controls.signInAs(ME.handle);
  return bev.id;
}

beforeEach(() => {
  mockAvailable = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  useSession.setState({ status: 'ready', checked: true, devForced: true, profile: { handle: ME.handle, displayName: ME.displayName, avatarUrl: null } });
});

afterEach(async () => {
  await idle();
  client.clear();
  jest.restoreAllMocks();
});

it('lists only the people ME follows, each with a switch off, under the caption', async () => {
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  expect(screen.getByRole('heading', { name: 'Post notifications' })).toBeTruthy();
  expect(screen.getByText(POST_NOTIFICATIONS_CAPTION)).toBeTruthy();
  expect(screen.getByLabelText('Search people you follow')).toBeTruthy();

  const following = new Set((await api.follows.listFollowing(meId, { limit: 50 })).items.map((p) => p.handle));
  const handles = listedHandles();
  expect(handles.length).toBeGreaterThan(0);
  for (const h of handles) expect(following.has(h)).toBe(true);
  // friend_e follows ME, and ME does not follow back.
  expect(handles).not.toContain('friend_e');
  expect(screen.queryAllByRole('switch').every((s) => s.props.value === false)).toBe(true);
});

it('search narrows the list on the server, and says so when no one matches', async () => {
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  await fireEvent.changeText(screen.getByLabelText('Search people you follow'), 'friend_b');
  await waitFor(() => expect(listedHandles()).toEqual(['friend_b']));
  await fireEvent.changeText(screen.getByLabelText('Search people you follow'), 'zzzz');
  expect(await screen.findByText('No one you follow matches "zzzz"')).toBeTruthy();
  await fireEvent.press(screen.getByText('Clear search'));
  await waitFor(() => expect(listedHandles().length).toBeGreaterThan(1));
});

it("switching someone on turns Posts on, and only their NEW ranking would be pushed; a re-rank and a like on it would not", async () => {
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  await flip(FRIEND.handle);
  expect(personSwitch(FRIEND.handle).props.value).toBe(true);
  expect(await api.notifications.getSettings()).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: true });
  expect((await api.notifications.listPostNotificationPeople({ q: FRIEND.handle })).items[0]).toMatchObject({ subscribed: true });

  const bevId = await rankSomethingNew(FRIEND.handle);
  const post = (await api.feed.listUser(friendId, { limit: 1 })).items[0]!;
  expect(controls.pendingPushes(meId)).toEqual([{ kind: 'post', actorHandle: FRIEND.handle, postId: post.id }]);

  // friend_b likes friend_a's new post: nothing for ME (those likes are never sent).
  controls.signInAs('friend_b');
  await api.feed.like(post.id);
  controls.signInAs(ME.handle);
  expect(controls.pendingPushes(meId)).toEqual([{ kind: 'post', actorHandle: FRIEND.handle, postId: post.id }]);

  // friend_a re-ranks it: no new push, and the old post's push goes with the old post.
  controls.signInAs(FRIEND.handle);
  const ids = (await api.rankings.listBucket('LOVED')).filter((x) => x !== bevId);
  await api.rankings.rerankBev({ bevId, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: ids.length, comparisons: [] });
  controls.signInAs(ME.handle);
  expect(controls.pendingPushes(meId)).toEqual([]);
});

it('switching someone on while paused ends the pause with only Posts on', async () => {
  await api.notifications.updateSettings({ paused: true, follows: true, likes: true, comments: true, posts: false });
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  await flip(FRIEND.handle);
  expect(await api.notifications.getSettings()).toEqual({ paused: false, follows: false, likes: false, comments: false, posts: true });
});

it('switching someone on when Posts is already on saves no settings', async () => {
  await api.notifications.updateSettings({ paused: false, follows: false, likes: true, comments: true, posts: true });
  const save = jest.spyOn(api.notifications, 'updateSettings');
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  await flip(FRIEND.handle);
  expect(save).not.toHaveBeenCalled();
});

it('switching someone off changes nothing else, and their posts are not pushed', async () => {
  await api.notifications.setPostNotification(friendId, true);
  await api.notifications.updateSettings({ paused: false, follows: true, likes: true, comments: true, posts: true });
  await open();
  await waitFor(() => expect(personSwitch(FRIEND.handle).props.value).toBe(true));
  // Chosen people come first.
  expect(listedHandles()[0]).toBe(FRIEND.handle);
  await flip(FRIEND.handle);
  expect(personSwitch(FRIEND.handle).props.value).toBe(false);
  expect(await api.notifications.getSettings()).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: true });
  await rankSomethingNew(FRIEND.handle);
  expect(controls.pendingPushes(meId)).toEqual([]);
});

it('a failed change puts the switch back, says so, and leaves Posts alone', async () => {
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  controls.failNext('network', 'notifications.setPostNotification');
  await flip(FRIEND.handle);
  expect(personSwitch(FRIEND.handle).props.value).toBe(false);
  expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^Couldn't change post notifications for ${FRIEND.handle}\\.`));
  expect((await api.notifications.getSettings()).posts).toBe(false);
});

it('Posts failing to turn on switches the person back off, and says post notifications could not be turned on', async () => {
  await open();
  await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) });
  controls.failNext('network', 'notifications.updateSettings');
  await flip(FRIEND.handle);
  await idle();
  expect(personSwitch(FRIEND.handle).props.value).toBe(false);
  expect(screen.getByRole('alert')).toHaveTextContent(/^Couldn't turn on post notifications\./);
  expect((await api.notifications.listPostNotificationPeople({ q: FRIEND.handle })).items[0]).toMatchObject({ subscribed: false });
  expect((await api.notifications.getSettings()).posts).toBe(false);
  await rankSomethingNew(FRIEND.handle);
  expect(controls.pendingPushes(meId)).toEqual([]);
});

it('follows no one: says so, and Find people opens People', async () => {
  controls.emptyUser();
  const r = await open();
  expect(await screen.findByText(POST_PEOPLE_EMPTY_TITLE)).toBeTruthy();
  await fireEvent.press(screen.getByText('Find people'));
  expect(r.path()).toBe('/people');
});

it('a failed load shows Retry, which reads it again', async () => {
  controls.failNext('unknown', 'notifications.listPostNotificationPeople');
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('switch', { name: personSwitchLabel(FRIEND.handle) })).toBeTruthy();
});

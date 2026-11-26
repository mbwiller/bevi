import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Slot } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import { AppState, Linking, Text } from 'react-native';

import { api } from '@/api/client';
import { countChosenPeople, type ChosenCount } from '@/api/hooks';
import NotificationSettingsRoute from '@/app/settings/notifications';
import SettingsIndexScreen from '@/app/settings/index';
import { useSession } from '@/state/session';
import { controls, FRIEND, ME, userIdFor } from '@/testing/fakeApi';
import { fakePhone, TEST_PUSH_TOKEN } from '@/testing/push';

import { chosenCountLabel, DENIED_LINE, PAUSE_CAPTION, PAUSED_CAPTION, SAVE_FAILED, SETTINGS_NOTE, TURN_ON_LINE } from '../NotificationSettingsScreen';
import { resetDeviceForTests } from '../push/device';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
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

function PostNotificationsStub() {
  return <Text>Post notifications stub</Text>;
}

async function open(url = '/settings/notifications') {
  const result = renderRouter(
    {
      _layout: Layout,
      'settings/index': SettingsIndexScreen,
      'settings/notifications': NotificationSettingsRoute,
      'settings/post-notifications': PostNotificationsStub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

const sw = (name: string) => screen.getByRole('switch', { name });
const shown = () =>
  Object.fromEntries(['Pause all', 'New followers', 'Likes', 'Comments', 'Posts'].map((n) => [n, sw(n).props.value as boolean]));
async function toggle(name: string) {
  await fireEvent(sw(name), 'valueChange', !sw(name).props.value);
}
/** Every save and read has landed, and the screen has drawn it (renderRouter turns on jest's fake timers). */
async function idle() {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  await act(() => jest.advanceTimersByTimeAsync(20));
}

/** ME's third newest post, which no fixture has liked or commented on. */
async function myQuietPost() {
  return (await api.feed.listUser(meId, { limit: 3 })).items[2]!;
}
/** As friend_a: like, and comment on, one of ME's posts. */
async function friendLikesAndComments(postId: string, comment = false) {
  controls.signInAs(FRIEND.handle);
  await api.feed.like(postId);
  if (comment) await api.comments.add(postId, 'Great pick');
  controls.signInAs(ME.handle);
}

beforeEach(async () => {
  mockAvailable = true;
  resetDeviceForTests();
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

it('opens on the defaults: Pause off, New followers, Likes and Comments on, Posts off, no one chosen', async () => {
  fakePhone({ permission: 'granted' });
  await open();
  await screen.findByRole('switch', { name: 'Pause all' });
  expect(shown()).toEqual({ 'Pause all': false, 'New followers': true, Likes: true, Comments: true, Posts: false });
  expect(screen.getByText(PAUSE_CAPTION)).toBeTruthy();
  expect(screen.getAllByText('On Bevs you posted')).toHaveLength(2);
  expect(screen.getByText('When people you choose post a Bev')).toBeTruthy();
  expect(screen.getByText(SETTINGS_NOTE)).toBeTruthy();
  expect(await screen.findByLabelText('Choose people, No one yet')).toBeTruthy();
  // Granted: nothing about the phone's permission.
  expect(screen.queryByText(TURN_ON_LINE)).toBeNull();
  expect(screen.queryByText(DENIED_LINE)).toBeNull();
});

it('Pause all: every kind shows off and nothing is pushed; off again, each kind is back as it was', async () => {
  fakePhone({ permission: 'granted' });
  await open();
  await screen.findByRole('switch', { name: 'Pause all' });
  await toggle('Comments');
  await idle();
  await toggle('Pause all');
  await idle();
  expect(shown()).toEqual({ 'Pause all': true, 'New followers': false, Likes: false, Comments: false, Posts: false });
  expect(screen.getByText(PAUSED_CAPTION)).toBeTruthy();
  expect(await api.notifications.getSettings()).toEqual({ paused: true, follows: true, likes: true, comments: false, posts: false });

  const post = await myQuietPost();
  await friendLikesAndComments(post.id);
  expect(controls.pendingPushes(meId)).toEqual([]);

  await toggle('Pause all');
  await idle();
  expect(shown()).toEqual({ 'Pause all': false, 'New followers': true, Likes: true, Comments: false, Posts: false });
  expect(controls.pendingPushes(meId)).toEqual([{ kind: 'like', actorHandle: FRIEND.handle, postId: post.id }]);
});

it('a kind switched on while paused ends the pause with only that kind on', async () => {
  fakePhone({ permission: 'granted' });
  await api.notifications.updateSettings({ paused: true, follows: true, likes: true, comments: true, posts: false });
  await open();
  await screen.findByRole('switch', { name: 'Pause all' });
  expect(shown()).toEqual({ 'Pause all': true, 'New followers': false, Likes: false, Comments: false, Posts: false });
  await toggle('Likes');
  await idle();
  expect(shown()).toEqual({ 'Pause all': false, 'New followers': false, Likes: true, Comments: false, Posts: false });
  expect(await api.notifications.getSettings()).toEqual({ paused: false, follows: false, likes: true, comments: false, posts: false });
});

it('Likes off stops like pushes but not comment pushes, and the inbox still lists both', async () => {
  fakePhone({ permission: 'granted' });
  await open();
  await screen.findByRole('switch', { name: 'Likes' });
  await toggle('Likes');
  await idle();
  expect(sw('Likes').props.value).toBe(false);

  const post = await myQuietPost();
  await friendLikesAndComments(post.id, true);
  expect(controls.pendingPushes(meId)).toEqual([{ kind: 'comment', actorHandle: FRIEND.handle, postId: post.id }]);
  const inbox = (await api.notifications.list()).items.filter((n) => n.postId === post.id).map((n) => n.kind);
  expect(inbox.sort()).toEqual(['comment', 'like']);
});

it('a failed save puts the switch back and says so', async () => {
  fakePhone({ permission: 'granted' });
  await open();
  await screen.findByRole('switch', { name: 'Likes' });
  controls.failNext('network', 'notifications.updateSettings');
  await toggle('Likes');
  await idle();
  expect(sw('Likes').props.value).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${SAVE_FAILED}`));
  expect((await api.notifications.getSettings()).likes).toBe(true);
});

it('loading shows skeleton rows; a failed load shows Retry, which reads it again', async () => {
  fakePhone({ permission: 'granted' });
  controls.setLatency(100);
  controls.failNext('unknown', 'notifications.getSettings');
  await open();
  expect(screen.getByTestId('notification-settings-skeleton')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('switch', { name: 'Pause all' })).toBeTruthy();
});

describe("the phone's own permission", () => {
  it('not asked yet: Turn on notifications asks, and the device is registered when the answer is yes', async () => {
    const phone = fakePhone({ permission: 'undetermined', answer: 'granted' });
    await open();
    expect(await screen.findByText(TURN_ON_LINE)).toBeTruthy();
    // The switches work all the same.
    expect(sw('Likes').props.disabled).toBeFalsy();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
    expect(phone.permission).toBe('granted');
    await waitFor(() => expect(screen.queryByText(TURN_ON_LINE)).toBeNull());
  });

  it('refused: says so and opens the phone\'s Settings', async () => {
    fakePhone({ permission: 'denied' });
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await open();
    expect(await screen.findByText(DENIED_LINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(settings).toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('is read again when the app comes back to the front', async () => {
    const handlers: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: 'change', h: (s: never) => void) => {
      handlers.push(h as (s: string) => void);
      return { remove: () => undefined };
    }) as typeof AppState.addEventListener);
    const phone = fakePhone({ permission: 'denied' });
    await open();
    expect(await screen.findByText(DENIED_LINE)).toBeTruthy();
    phone.permission = 'granted';
    await act(async () => handlers.forEach((h) => h('active')));
    await waitFor(() => expect(screen.queryByText(DENIED_LINE)).toBeNull());
  });
});

describe('Choose people', () => {
  it('counts who is chosen and opens Post notifications', async () => {
    fakePhone({ permission: 'granted' });
    await api.notifications.setPostNotification(friendId, true);
    const r = await open();
    await fireEvent.press(await screen.findByLabelText('Choose people, 1 person'));
    expect(r.path()).toBe('/settings/post-notifications');
  });

  it('reads "N people" for more than one', async () => {
    fakePhone({ permission: 'granted' });
    const following = (await api.notifications.listPostNotificationPeople()).items.slice(0, 3);
    for (const p of following) await api.notifications.setPostNotification(p.id, true);
    await open();
    expect(await screen.findByLabelText('Choose people, 3 people')).toBeTruthy();
  });

  it.each<[ChosenCount, string]>([
    [{ count: 0, capped: false }, 'No one yet'],
    [{ count: 1, capped: false }, '1 person'],
    [{ count: 7, capped: false }, '7 people'],
    [{ count: 100, capped: true }, '100+ people'],
  ])('label %p: %s', (chosen, label) => {
    expect(chosenCountLabel(chosen)).toBe(label);
  });

  it('counts the chosen at the head of the list, reading on only while a page ends on a chosen row, up to 100', async () => {
    const person = (subscribed: boolean, i: number) => ({ id: `u${i}`, subscribed }) as never;
    const pages = (rows: boolean[], size: number) => {
      const calls: (string | undefined)[] = [];
      const list = async (cursor: string | undefined) => {
        calls.push(cursor);
        const start = cursor ? Number(cursor) : 0;
        const items = rows.slice(start, start + size).map((s, i) => person(s, start + i));
        return { items, nextCursor: start + size < rows.length ? String(start + size) : null };
      };
      return { list, calls };
    };
    let p = pages([false, false], 50);
    expect(await countChosenPeople(p.list)).toEqual({ count: 0, capped: false });
    p = pages([true, true, true, false, false], 2);
    expect(await countChosenPeople(p.list)).toEqual({ count: 3, capped: false });
    expect(p.calls).toEqual([undefined, '2']);
    p = pages([true, true, false, false, false, false], 2);
    expect(await countChosenPeople(p.list)).toEqual({ count: 2, capped: false });
    expect(p.calls).toEqual([undefined, '2']);
    p = pages(Array(30).fill(true), 50);
    expect(await countChosenPeople(p.list)).toEqual({ count: 30, capped: false });
    p = pages(Array(250).fill(true), 50);
    expect(await countChosenPeople(p.list)).toEqual({ count: 100, capped: true });
    expect(p.calls).toHaveLength(2);
  });
});

describe('with the gate off', () => {
  beforeEach(() => {
    mockAvailable = false;
  });

  it('Settings has no Notifications row, and its URL lands on Settings', async () => {
    const r = await open('/settings');
    expect(await screen.findByLabelText('Privacy')).toBeTruthy();
    expect(screen.queryByLabelText('Notifications')).toBeNull();
    const asked = jest.spyOn(Notifications, 'getPermissionsAsync');
    await act(async () => router.push('/settings/notifications'));
    await waitFor(() => expect(r.path()).toBe('/settings'));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('with the gate on', () => {
  it('Settings lists Notifications after Privacy, and it opens this screen', async () => {
    fakePhone({ permission: 'granted' });
    const r = await open('/settings');
    const labels = (await screen.findAllByRole('link')).map((l) => l.props.accessibilityLabel as string);
    expect(labels.slice(0, 4)).toEqual(['Account', 'Privacy', 'Notifications', 'Blocked accounts']);
    await fireEvent.press(screen.getByLabelText('Notifications'));
    expect(r.path()).toBe('/settings/notifications');
    expect(await screen.findByRole('switch', { name: 'Pause all' })).toBeTruthy();
  });
});

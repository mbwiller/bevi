import type { Notification } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import FeedRoute from '@/app/(tabs)/feed/index';
import TabsLayout from '@/app/(tabs)/_layout';
import NotificationsRoute from '@/app/(tabs)/notifications/index';
import { controls, ME } from '@/testing/fakeApi';

import { NOTIFICATIONS_EMPTY_BODY, NOTIFICATIONS_EMPTY_TITLE } from '../NotificationsScreen';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const Stub = () => null;

/** The tabs group as the app has it (so the Notifications screen stays mounted between visits), the Feed real, the rest stubs. */
async function start(url = '/notifications') {
  const result = renderRouter(
    {
      _layout: Layout,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/feed/index': FeedRoute,
      '(tabs)/lists/index': Stub,
      '(tabs)/add/index': Stub,
      '(tabs)/map/index': Stub,
      '(tabs)/profile/index': Stub,
      '(tabs)/people/index': Stub,
      '(tabs)/notifications/index': NotificationsRoute,
      'post/[id]': Stub,
      'user/[id]/index': Stub,
      index: Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

// Pin "now" (Date only; timers stay real), so the fixture inbox (dealt relative to now) and the
// sections and ages read the same on any day.
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
beforeAll(() => {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
});

afterEach(async () => {
  controls.setLatency(0);
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

/** The fixture inbox as the API lists it, before the screen marks anything read. */
async function inbox(): Promise<Notification[]> {
  return (await api.notifications.list()).items;
}

const rows = () => screen.queryAllByTestId('notification-row');
const rowLabels = () =>
  rows().map((r) => within(r).getAllByRole('button')[0]!.props.accessibilityLabel as string);
/** The keys of what the list holds, in order: sections and rows. */
const listOrder = () => (list().props.data as { key: string }[]).map((i) => i.key);
const headings = () => screen.queryAllByRole('heading').map((h) => h.props.children as string);

it('lists the fixture inbox under New and Earlier, with the sentences the design system words', async () => {
  const items = await inbox();
  const likes = items.find((n) => n.kind === 'like' && n.unread)!;
  const comment = items.find((n) => n.kind === 'comment' && n.unread)!;
  const oldLike = items.find((n) => n.kind === 'like' && !n.unread)!;
  const oldComment = items.find((n) => n.kind === 'comment' && !n.unread)!;
  await start();
  await screen.findByText('Need to try this', { exact: false });

  expect(headings()).toEqual(['Notifications', 'New', 'Earlier']);
  expect(rowLabels()).toEqual([
    `Unread. friend_a and friend_b liked your ${likes.bev!.name}, 2 minutes ago`,
    `Unread. friend_a commented on your ${comment.bev!.name}, 6 minutes ago. “Need to try this”`,
    'Unread. friend_e started following you, 10 minutes ago',
    expect.stringMatching(new RegExp(`^friend_b commented on your ${oldComment.bev!.name}, \\w+ \\d+. “Still thinking about this one”$`)),
    expect.stringMatching(new RegExp(`^friend_d liked your ${oldLike.bev!.name}, \\w+ \\d+$`)),
    expect.stringMatching(/^friend_d started following you, \w+ \d+$/),
  ]);
  // The short ages on screen.
  expect(screen.getByText(' · 2m')).toBeTruthy();
  // A follow row ends in its pill: friend_e is not followed back, friend_d is.
  expect(screen.getByRole('button', { name: 'Follow back friend_e' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Following friend_d' })).toBeTruthy();
});

it('opening it marks everything read and clears the bell at once, while the rows still read as unread', async () => {
  const newest = (await inbox())[0]!;
  const markRead = jest.spyOn(api.notifications, 'markRead');
  await start();
  await screen.findByText('Need to try this', { exact: false });

  await waitFor(() => expect(markRead).toHaveBeenCalledWith(newest.id));
  expect(markRead).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(client.getQueryData(keys.notifications.unreadCount())).toBe(0));
  expect(await api.notifications.unreadCount()).toBe(0);
  // Still tinted and under New while the person is here.
  expect(headings()).toContain('New');
  expect(rowLabels().filter((l) => l.startsWith('Unread. '))).toHaveLength(3);
});

it('leaving and opening it again from the bell shows them read, and marks what came in meanwhile', async () => {
  const markRead = jest.spyOn(api.notifications, 'markRead');
  const { path } = await start('/feed');
  // Three unread: the bell says so, and its badge shows the number.
  const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
  expect(within(bell).getByText('3')).toBeTruthy();
  await fireEvent.press(bell);
  await waitFor(() => expect(path()).toBe('/notifications'));
  await screen.findByText('Need to try this', { exact: false });
  await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));

  // Back to the Feed: the bell has no count now.
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(path()).toBe('/feed'));
  expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();

  // Someone new follows while the screen is away (the same mounted screen, so only focus can see it).
  controls.signInAs('friend_c');
  await api.follows.follow('user-tester');
  controls.signInAs(ME.handle);
  await act(() => client.invalidateQueries({ queryKey: keys.notifications.unreadCount() }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
  await waitFor(() => expect(path()).toBe('/notifications'));

  // The new follow is the one unread row, first under New; the rest read as read. (FlashList recycles
  // its cells, so the rows' order on screen is read from the list's data, not the rendered tree.)
  expect(await screen.findByLabelText('Unread. friend_c started following you, Just now')).toBeTruthy();
  expect(rowLabels().filter((l) => l.startsWith('Unread. '))).toHaveLength(1);
  expect(listOrder().slice(0, 2)).toEqual(['section:new', `n:${(await inbox())[0]!.id}`]);
  // Marked on this second opening too.
  await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
  expect(await api.notifications.unreadCount()).toBe(0);
  await waitFor(() => expect(client.getQueryData(keys.notifications.unreadCount())).toBe(0));

  // Leave again and come back: nothing is new, so no New section and nothing more to mark.
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(path()).toBe('/feed'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Notifications' }));
  await waitFor(() => expect(path()).toBe('/notifications'));
  await waitFor(() => expect(headings()).not.toContain('New'));
  expect(rowLabels().some((l) => l.startsWith('Unread. '))).toBe(false);
  expect(listOrder().filter((k) => k.startsWith('section:'))).toEqual(['section:today', 'section:earlier']);
  expect(markRead).toHaveBeenCalledTimes(2);
});

it('Follow back follows them and flips the pill, without opening the profile', async () => {
  const follow = jest.spyOn(api.follows, 'follow');
  const { path } = await start();
  await fireEvent.press(await screen.findByRole('button', { name: 'Follow back friend_e' }));
  expect(await screen.findByRole('button', { name: 'Following friend_e' })).toBeTruthy();
  await waitFor(() => expect(follow).toHaveBeenCalledWith('user-friend_e'));
  expect(path()).toBe('/notifications');
  // The row stays unread while the screen is open: the list was only marked stale.
  expect(rowLabels()).toContain('Unread. friend_e started following you, 10 minutes ago');
});

it('a like opens its post, a comment the post with its comments up, a follow the person', async () => {
  const items = await inbox();
  const likes = items.find((n) => n.kind === 'like' && n.unread)!;
  const comment = items.find((n) => n.kind === 'comment' && n.unread)!;
  const { path } = await start();
  await screen.findByText('Need to try this', { exact: false });

  await fireEvent.press(screen.getByLabelText(/^Unread\. friend_a and friend_b liked your/));
  await waitFor(() => expect(path()).toBe(`/post/${likes.postId}`));
  await act(async () => router.back());
  await waitFor(() => expect(path()).toBe('/notifications'));

  // Back from the post: the screen was left, so the rows read as read now.
  await fireEvent.press(await screen.findByLabelText(/^friend_a commented on your/));
  await waitFor(() => expect(path()).toBe(`/post/${comment.postId}?comments=1`));
  await act(async () => router.back());
  await waitFor(() => expect(path()).toBe('/notifications'));

  await fireEvent.press(await screen.findByLabelText(/^friend_e started following you/));
  await waitFor(() => expect(path()).toBe('/user/user-friend_e'));
});

it('empty: says so, and Find people opens People', async () => {
  controls.clearNotifications();
  const { path } = await start();
  expect(await screen.findByText(NOTIFICATIONS_EMPTY_TITLE)).toBeTruthy();
  expect(screen.getByText(NOTIFICATIONS_EMPTY_BODY)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Find people' }));
  await waitFor(() => expect(path()).toBe('/people'));
});

it('a failed read shows ErrorState, and Retry loads the inbox', async () => {
  controls.failNext('network', 'notifications.list');
  await start();
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(rows()).toHaveLength(0);
  await fireEvent.press(retry);
  await screen.findByText('Need to try this', { exact: false });
  expect(rows()).toHaveLength(6);
});

/** The props the screen gave its FlashList (`onEndReached` never reaches the host ScrollView). */
function list(): { props: Record<string, any> } {
  type Fiber = { elementType: unknown; memoizedProps: Record<string, any>; return: Fiber | null };
  let f = screen.getByTestId('notifications-list').unstable_fiber as Fiber | null;
  while (f && f.elementType !== FlashList) f = f.return;
  if (!f) throw new Error('No FlashList above notifications-list');
  return { props: f.memoizedProps };
}

it('pages in older rows at the end of the list, one request per page', async () => {
  // Pages of two, so the six fixture rows take three, and a fourth (full pages always say "maybe
  // more") comes back empty. Under jest FlashList reaches its end at once.
  const real = api.notifications.list;
  const pages = jest.spyOn(api.notifications, 'list').mockImplementation((page) => real({ ...page, limit: 2 }));
  await start();
  await waitFor(() => expect(rows()).toHaveLength(6));
  await waitFor(() => expect(pages).toHaveBeenCalledTimes(4));
  expect(pages.mock.calls.map(([p]) => p?.cursor ?? null)).toEqual([null, expect.any(String), expect.any(String), expect.any(String)]);
  expect(new Set(pages.mock.calls.map(([p]) => p?.cursor)).size).toBe(4);
  expect(listOrder().filter((k) => k.startsWith('section:'))).toEqual(['section:new', 'section:earlier']);
  // The empty page said there is no more: reaching the end again asks for nothing.
  await act(async () => list().props.onEndReached());
  expect(pages).toHaveBeenCalledTimes(4);
});

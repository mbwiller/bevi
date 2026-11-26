import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import * as Notifications from 'expo-notifications';

import { api } from '@/api/client';
import * as push from '@/features/notifications/push/push';
import { useSession, type SessionStatus } from '@/state/session';
import { controls } from '@/testing/fakeApi';

// jest can't run a dynamic import(); the root layout's lazy bug reporter gets the module directly.
jest.mock('@/features/bug-report/loadHost', () => ({
  loadReportHost: () => Promise.resolve({ default: require('@/features/bug-report/ReportHost').default }),
}));
jest.mock('@/features/create-bev/loadNutritionDemo', () => ({
  loadNutritionDemo: () => Promise.resolve({ default: require('@/features/create-bev/NutritionDemo').NutritionDemo }),
}));

// The real route tree in src/app, rendered by expo-router's test harness.
const APP_DIR = path.resolve(__dirname, '../app');

/**
 * Renders the app at `initialUrl` with the given session status set directly (skipping the launch
 * check), and returns a pathname reader.
 * (renderRouter attaches getPathname to the render promise; RNTL 14's async render means
 * `expect(screen).toHavePathname` can't see it.)
 */
async function start(status: SessionStatus, initialUrl = '/') {
  useSession.setState({ status, profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

describe('session gate', () => {
  it.each([
    ['signedOut', '/sign-in', 'Sign in'],
    ['onboarding', '/onboarding/profile', 'Your profile'],
    ['ready', '/feed', 'Your feed'],
  ] as const)('%s: / redirects to %s', async (status, pathname, title) => {
    const path = await start(status);
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
    expect(path()).toBe(pathname);
  });

  it('keeps routes of another status out of reach', async () => {
    const path = await start('signedOut', '/settings');
    await screen.findByText('Create account');
    expect(path()).toBe('/sign-in');
  });

  it('opens a deep link the status allows', async () => {
    const path = await start('ready', '/bev/abc');
    await screen.findByLabelText('Back');
    expect(path()).toBe('/bev/abc');
  });

  it('signing out from inside the app lands on sign in', async () => {
    const path = await start('ready', '/settings');
    await screen.findByText('Account');
    await act(async () => useSession.getState().signOut());
    await screen.findByText('Create account');
    expect(path()).toBe('/sign-in');
  });

  it('shows not-found for an unknown URL', async () => {
    await start('ready', '/no/such/page');
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });

  it.each(['/dev/gallery', '/dev/tokens'])('has no dev route at %s', async (url) => {
    await start('ready', url);
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });
});

describe('the bug reporter, for an internal reporter', () => {
  beforeEach(() => {
    signInFake();
    controls.setInternalReporter(true);
  });
  afterEach(() => controls.resetToFixtures());

  // The button itself is covered by features/bug-report (ReportButton.test.tsx).
  it("puts the report button on the Feed and nothing in the Feed header's actions", async () => {
    await start('ready', '/feed');
    expect(await screen.findByRole('button', { name: 'Report' })).toBeTruthy();
    const header = screen.getByLabelText('Find people').parent!;
    // The bell, then Find people (T-31). The fixture inbox has three unread rows, so the bell says so.
    await waitFor(() =>
      expect(within(header).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
        'Notifications, 3 unread',
        'Find people',
      ]),
    );
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('keeps the report button on the not-found page, which has no header', async () => {
    await start('ready', '/no/such/page');
    await screen.findByText('Page not found');
    expect(await screen.findByRole('button', { name: 'Report' })).toBeTruthy();
    expect(screen.getAllByLabelText('Report')).toHaveLength(1);
  });
});

const SEARCH_BAR = 'Search a Bev or a person';

/** The People history cases need real rows, so the fake API gets a signed-in account with no latency. */
function signInFake() {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
}

/** One tab bar on screen: exactly the five tabs (People adds none), with Feed the current one. */
function expectFeedMarkedOnFiveTabs() {
  const bar = screen.getByLabelText('Main');
  expect(within(bar).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Feed', 'Lists', 'Add Bev', 'Map', 'Profile']);
  expect(within(bar).getByLabelText('Feed').props.accessibilityState).toEqual({ selected: true });
}

describe('tab bar', () => {
  it('/add is the Add Bev tab: "Add a Bev", the bar, no map and no Cancel', async () => {
    const path = await start('ready', '/add');
    expect(await screen.findByRole('heading', { name: 'Add a Bev' })).toBeTruthy();
    expect(path()).toBe('/add');
    expect(screen.getByLabelText(SEARCH_BAR)).toBeTruthy();
    expect(screen.getByLabelText('Add Bev').props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText('Map unavailable right now')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('pressing the Add Bev tab while it shows clears the query and hides Cancel', async () => {
    const path = await start('ready', '/add');
    const bar = await screen.findByLabelText(SEARCH_BAR);
    await fireEvent.changeText(bar, 'coke');
    expect(screen.getByLabelText(SEARCH_BAR).props.value).toBe('coke');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add Bev'));
    await waitFor(() => expect(screen.getByLabelText(SEARCH_BAR).props.value).toBe(''));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(path()).toBe('/add');
  });

  it('Cancel on /add shows while typing, and clears the query and itself', async () => {
    const path = await start('ready', '/add');
    const bar = await screen.findByLabelText(SEARCH_BAR);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await fireEvent.changeText(bar, 'coke');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByLabelText(SEARCH_BAR).props.value).toBe(''));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(path()).toBe('/add');
  });

  it('?focus=1 focuses the Add Bev bar', async () => {
    const path = await start('ready', '/add?focus=1');
    await waitFor(() => expect(screen.getByLabelText(SEARCH_BAR).props.autoFocus).toBe(true));
    expect(path()).toBe('/add');
  });

  it('/search is the Add Bev tab', async () => {
    const path = await start('ready', '/search');
    expect(await screen.findByRole('heading', { name: 'Add a Bev' })).toBeTruthy();
    expect(path()).toBe('/add');
    expect(screen.getByLabelText('Add Bev').props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText('Map unavailable right now')).toBeNull();
  });

  it('navigates between the five tabs and marks the current one', async () => {
    const path = await start('ready', '/feed');
    for (const [label, pathname] of [
      ['Lists', '/lists'],
      ['Add Bev', '/add'],
      ['Map', '/map'],
      ['Profile', '/profile'],
      ['Feed', '/feed'],
    ] as const) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(path()).toBe(pathname);
      expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ selected: true });
    }
  });

  it("Feed's Find people opens the People screen", async () => {
    const path = await start('ready', '/feed');
    await fireEvent.press(await screen.findByLabelText('Find people'));
    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
    expect(path()).toBe('/people');
  });

  it('/people keeps the bar, with Feed marked and still five tabs (design system ScreenPeople)', async () => {
    const path = await start('ready', '/people');
    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
    expect(path()).toBe('/people');
    expectFeedMarkedOnFiveTabs();
  });

  it("People's back returns to the Feed it was opened from", async () => {
    const path = await start('ready', '/feed');
    await fireEvent.press(await screen.findByLabelText('Find people'));
    await screen.findByRole('heading', { name: 'People' });
    expectFeedMarkedOnFiveTabs();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(path()).toBe('/feed'));
    expect(screen.queryByRole('heading', { name: 'People' })).toBeNull();
  });

  it('opening a person from People and going back returns to People', async () => {
    signInFake();
    const me = await api.profile.getMe();
    const person = (await api.follows.suggested()).find((r) => r.id !== me.id)!;
    const path = await start('ready', '/people');
    // The person can be both suggested and on the board; the first row is the suggestion.
    await fireEvent.press((await screen.findAllByLabelText(new RegExp(`^${person.displayName}, @${person.handle}`)))[0]!);
    await waitFor(() => expect(path()).toBe(`/user/${person.id}`));
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(path()).toBe('/people'));
    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
    expectFeedMarkedOnFiveTabs();
  });

  it("People opened from the Following list's Find people goes back to that list", async () => {
    signInFake();
    controls.emptyUser();
    try {
      const me = await api.profile.getMe();
      const path = await start('ready', `/user/${me.id}/following`);
      await screen.findByText("You're not following anyone yet");
      await fireEvent.press(screen.getByLabelText('Find people'));
      expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
      expect(path()).toBe('/people');
      expectFeedMarkedOnFiveTabs();
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => expect(path()).toBe(`/user/${me.id}/following`));
      expect(await screen.findByText("You're not following anyone yet")).toBeTruthy();
    } finally {
      controls.resetToFixtures();
    }
  });

  it('a tab pressed on People leaves it for that tab', async () => {
    const path = await start('ready', '/people');
    await screen.findByRole('heading', { name: 'People' });
    await fireEvent.press(screen.getByLabelText('Lists'));
    expect(path()).toBe('/lists');
    expect(screen.getByLabelText('Lists').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByLabelText('Feed'));
    expect(path()).toBe('/feed');
  });

  it("Feed's bell opens Notifications, which keeps the bar with Feed marked", async () => {
    signInFake();
    const path = await start('ready', '/feed');
    await fireEvent.press(await screen.findByRole('button', { name: 'Notifications, 3 unread' }));
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(path()).toBe('/notifications');
    expectFeedMarkedOnFiveTabs();
  });

  it('/notifications keeps the bar, with Feed marked and still five tabs (design system ScreenNotifications)', async () => {
    signInFake();
    const path = await start('ready', '/notifications');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(path()).toBe('/notifications');
    expectFeedMarkedOnFiveTabs();
  });

  it("Notifications' back returns to the Feed, whose bell has no count now", async () => {
    signInFake();
    const path = await start('ready', '/feed');
    await fireEvent.press(await screen.findByRole('button', { name: 'Notifications, 3 unread' }));
    await screen.findByRole('heading', { name: 'Notifications' });
    // Opened and read: the rows are in, and marking them read has reached the server.
    await screen.findByLabelText('Unread. friend_e started following you, 10 minutes ago');
    await waitFor(async () => expect(await api.notifications.unreadCount()).toBe(0));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(path()).toBe('/feed'));
    expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it.each([
    ['signedOut', '/sign-in', 'Create account'],
    ['onboarding', '/onboarding/profile', 'Your profile'],
  ] as const)('/notifications and /post are out of reach when %s', async (status, pathname, text) => {
    for (const url of ['/notifications', '/post/abc']) {
      const path = await start(status, url);
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
      expect(path()).toBe(pathname);
    }
  });

  it.each([
    ['signedOut', '/sign-in', 'Create account'],
    ['onboarding', '/onboarding/profile', 'Your profile'],
  ] as const)('/people is out of reach when %s', async (status, pathname, text) => {
    const path = await start(status, '/people');
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    expect(path()).toBe(pathname);
  });

  it('/leaderboard lands on Lists, Top', async () => {
    const path = await start('ready', '/leaderboard');
    await waitFor(() => expect(path()).toBe('/lists'));
    expect(screen.getByLabelText('Lists').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('Top').props.accessibilityState).toEqual({ selected: true });
  });

  it('/leaderboard?scope=users lands on People, with the bar', async () => {
    const path = await start('ready', '/leaderboard?scope=users');
    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
    expect(path()).toBe('/people');
    expectFeedMarkedOnFiveTabs();
  });

  it('shows the session profile on the Profile tab', async () => {
    useSession.setState({
      status: 'ready',
      profile: { handle: 'tester', displayName: 'Test User', avatarUrl: null },
      checked: true,
      devForced: true,
    });
    await renderRouter(APP_DIR, { initialUrl: '/profile' });
    expect(await screen.findByText('Test User')).toBeTruthy();
    expect(screen.getByText('TU')).toBeTruthy();
  });
});

// T-31 Release 2: push is built but off until the build can receive it (`extra.push`, which jest's
// app config does not set). The whole app, signed in, behaves as it did before push existed.
describe('push, with the gate off', () => {
  const WRAPPER = [
    'getPushPermission',
    'requestPushPermission',
    'getPushToken',
    'setAppBadge',
    'configureForegroundPresentation',
    'onPushReceived',
    'onPushOpened',
    'openSystemSettings',
  ] as const;
  const NATIVE = [
    'getPermissionsAsync',
    'requestPermissionsAsync',
    'getExpoPushTokenAsync',
    'setBadgeCountAsync',
    'setNotificationHandler',
    'addNotificationReceivedListener',
    'addNotificationResponseReceivedListener',
    'getLastNotificationResponse',
  ] as const;
  let spies: jest.SpyInstance[];
  beforeEach(() => {
    signInFake();
    spies = [...WRAPPER.map((name) => jest.spyOn(push, name)), ...NATIVE.map((name) => jest.spyOn(Notifications, name))];
  });
  afterEach(() => {
    jest.restoreAllMocks();
    controls.resetToFixtures();
  });

  it('Settings has no Notifications row, and nothing push is called', async () => {
    await start('ready', '/settings');
    await screen.findByText('Account');
    expect(screen.queryByLabelText('Notifications')).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('the inbox has no gear and no ask, and nothing push is called', async () => {
    const path = await start('ready', '/notifications');
    await screen.findByLabelText('Unread. friend_e started following you, 10 minutes ago');
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
    expect(screen.queryByTestId('notifications-ask')).toBeNull();
    expect(path()).toBe('/notifications');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('a link to Settings > Notifications lands on Settings', async () => {
    const path = await start('ready', '/settings/notifications');
    await screen.findByText('Account');
    expect(path()).toBe('/settings');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('standalone nutrition demo', () => {
  it('opens the scanner while signed out when explicitly enabled', async () => {
    const previous = process.env.EXPO_PUBLIC_NUTRITION_SCAN_DEMO;
    process.env.EXPO_PUBLIC_NUTRITION_SCAN_DEMO = '1';
    try {
      await start('signedOut');
      expect(await screen.findByText('Scan a Bev')).toBeTruthy();
      expect(screen.getByLabelText('Scan barcode for nutrition')).toBeTruthy();
      expect(screen.queryByText('Sign in')).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_NUTRITION_SCAN_DEMO;
      else process.env.EXPO_PUBLIC_NUTRITION_SCAN_DEMO = previous;
    }
  });
});

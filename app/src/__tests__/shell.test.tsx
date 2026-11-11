import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { useSession, type SessionStatus } from '@/state/session';
import { controls } from '@/testing/fakeApi';

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

describe('Report a bug, for an internal reporter', () => {
  beforeEach(() => {
    signInFake();
    controls.setInternalReporter(true);
  });
  afterEach(() => controls.resetToFixtures());

  // Pressing it is covered by the launcher's suite: the reporter route lazy-loads its form, which this harness can't import.
  it("is the first of the Feed header's actions", async () => {
    await start('ready', '/feed');
    await screen.findByRole('button', { name: 'Report a bug' });
    const header = screen.getByLabelText('Find people').parent!;
    expect(within(header).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Report a bug', 'Find people']);
  });

  it('is in the header on a pushed screen (People)', async () => {
    await start('ready', '/people');
    expect(await screen.findByRole('button', { name: 'Report a bug' })).toBeTruthy();
    expect(screen.getAllByLabelText('Report a bug')).toHaveLength(1);
  });

  it('falls back to the pill on the not-found page, which has no header', async () => {
    await start('ready', '/no/such/page');
    await screen.findByText('Page not found');
    expect(await screen.findByRole('button', { name: 'Report a bug' })).toBeTruthy();
    expect(screen.getAllByLabelText('Report a bug')).toHaveLength(1);
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

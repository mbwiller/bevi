import path from 'path';

import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSession, type SessionStatus } from '@/state/session';

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

describe('tab bar', () => {
  it("Feed's Find people opens Search with the results panel up", async () => {
    const path = await start('ready', '/feed');
    await fireEvent.press(await screen.findByLabelText('Find people'));
    expect(path()).toBe('/add');
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('/search is the Search tab', async () => {
    const path = await start('ready', '/search');
    expect(await screen.findByText('Map coming soon')).toBeTruthy();
    expect(path()).toBe('/add');
    expect(screen.getByLabelText('Search').props.accessibilityState).toEqual({ selected: true });
  });

  it('navigates between tabs and marks the current one', async () => {
    const path = await start('ready', '/feed');
    for (const [label, pathname] of [
      ['Leaderboard', '/leaderboard'],
      ['Your Lists', '/lists'],
      ['Search', '/add'],
      ['Profile', '/profile'],
      ['Feed', '/feed'],
    ] as const) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(path()).toBe(pathname);
      expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ selected: true });
    }
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

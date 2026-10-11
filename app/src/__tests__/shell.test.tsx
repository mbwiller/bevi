import path from 'path';

import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSession, type SessionStatus } from '@/state/session';

// The real route tree in src/app, rendered by expo-router's test harness.
const APP_DIR = path.resolve(__dirname, '../app');

/**
 * Renders the app at `initialUrl` with the given session status and returns a pathname reader.
 * (renderRouter attaches getPathname to the render promise; RNTL 14's async render means
 * `expect(screen).toHavePathname` can't see it.)
 */
async function start(status: SessionStatus, initialUrl = '/') {
  useSession.setState({ status, profile: undefined });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

describe('session gate', () => {
  it.each([
    ['signedOut', '/sign-in', 'Sign in'],
    ['onboarding', '/onboarding/profile', 'Your profile'],
    ['ready', '/feed', 'Feed'],
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

  it('keeps the dev routes reachable when signed out', async () => {
    const path = await start('signedOut', '/dev/tokens');
    expect(path()).toBe('/dev/tokens');
  });
});

describe('tab bar', () => {
  it('navigates between tabs and marks the current one', async () => {
    const path = await start('ready', '/feed');
    for (const [label, pathname] of [
      ['Leaderboard', '/leaderboard'],
      ['Your Lists', '/lists'],
      ['Add Bev', '/add'],
      ['Profile', '/profile'],
      ['Feed', '/feed'],
    ] as const) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(path()).toBe(pathname);
      expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ selected: true });
    }
  });

  it('shows the session profile on the Profile tab', async () => {
    useSession.setState({ status: 'ready', profile: { handle: 'tester', displayName: 'Test User', avatarUrl: null } });
    await renderRouter(APP_DIR, { initialUrl: '/profile' });
    expect(await screen.findByText('Test User')).toBeTruthy();
    expect(screen.getByText('TU')).toBeTruthy();
  });
});

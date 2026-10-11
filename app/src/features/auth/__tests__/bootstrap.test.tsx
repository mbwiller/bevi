import path from 'path';

import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import { useSession } from '@/state/session';

const APP_DIR = path.resolve(__dirname, '../../../app');
const controls = mockControls!;

/** A fresh launch: nothing forced, so the API decides (as for a real visitor). */
async function launch(initialUrl = '/') {
  useSession.setState({ status: 'signedOut', profile: undefined, checked: false, devForced: false });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
});

describe('session bootstrap (mock API)', () => {
  it('no session: lands on sign in', async () => {
    const path = await launch();
    await screen.findByLabelText('Username');
    expect(path()).toBe('/sign-in');
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', checked: true });
  });

  it('shows the splash until the first check settles', async () => {
    controls.setLatency(50);
    useSession.setState({ status: 'signedOut', profile: undefined, checked: false, devForced: false });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen.getByLabelText('Loading Bevi')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    await screen.findByLabelText('Username', {}, { timeout: 2000 });
  });

  it('an onboarded session: ready, with the profile, on the feed', async () => {
    controls.signInAs('demo');
    const path = await launch();
    await screen.findAllByText('Feed');
    expect(path()).toBe('/feed');
    expect(useSession.getState().status).toBe('ready');
    expect(useSession.getState().profile?.handle).toBe('demo');
  });

  it('a session that has not onboarded: onboarding', async () => {
    controls.signInAs('demo');
    controls.emptyUser();
    const path = await launch();
    await screen.findByLabelText('Display name');
    expect(path()).toBe('/onboarding/profile');
    expect(useSession.getState().status).toBe('onboarding');
  });

  it('keeps a deep link through the check', async () => {
    controls.signInAs('demo');
    const path = await launch('/settings');
    await screen.findByText('Account');
    expect(path()).toBe('/settings');
  });

  it('offline on launch: the splash shows the error with Retry, then recovers', async () => {
    controls.signInAs('demo');
    controls.failNext('network', 'profile.getMe');
    const path = await launch();
    await fireEvent.press(await screen.findByText('Retry'));
    await screen.findAllByText('Feed');
    expect(path()).toBe('/feed');
  });

  it('a sign-out from anywhere lands on sign in', async () => {
    controls.signInAs('demo');
    const path = await launch('/settings');
    await screen.findByText('Account');
    await act(() => api.signOut());
    await screen.findByLabelText('Username');
    expect(path()).toBe('/sign-in');
  });

  it('the dev override (?session=) skips the launch check, then follows real auth events', async () => {
    useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
    const result = renderRouter(APP_DIR, { initialUrl: '/' });
    await result;
    await screen.findByText('Your profile');
    expect(result.getPathname()).toBe('/onboarding/profile');
    expect(useSession.getState().status).toBe('onboarding');
    await act(async () => controls.signInAs('demo'));
    await screen.findAllByText('Feed');
    expect(result.getPathname()).toBe('/feed');
  });
});

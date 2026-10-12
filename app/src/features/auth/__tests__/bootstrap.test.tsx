import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

const APP_DIR = path.resolve(__dirname, '../../../app');

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

describe('session bootstrap (FakeApi)', () => {
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
    controls.signInAs('tester');
    const path = await launch();
    await screen.findAllByText('Your feed');
    expect(path()).toBe('/feed');
    expect(useSession.getState().status).toBe('ready');
    expect(useSession.getState().profile?.handle).toBe('tester');
  });

  it('a session that has not onboarded: onboarding', async () => {
    controls.signInAs('tester');
    controls.emptyUser();
    const path = await launch();
    await screen.findByLabelText('Display name');
    expect(path()).toBe('/onboarding/profile');
    expect(useSession.getState().status).toBe('onboarding');
  });

  it('keeps a deep link through the check', async () => {
    controls.signInAs('tester');
    const path = await launch('/settings');
    await screen.findByText('Account');
    expect(path()).toBe('/settings');
  });

  it('offline on launch: the splash shows the error with Retry, then recovers', async () => {
    controls.signInAs('tester');
    controls.failNext('network', 'profile.getMe');
    const path = await launch();
    await fireEvent.press(await screen.findByText('Retry'));
    await screen.findAllByText('Your feed');
    expect(path()).toBe('/feed');
  });

  it('after the first check, a failing getMe keeps the current screen and retries quietly', async () => {
    controls.signInAs('tester');
    const path = await launch('/settings');
    await screen.findByText('Account');
    const getMe = jest.spyOn(api.profile, 'getMe');
    controls.failNext('network', 'profile.getMe');
    await act(async () => controls.signInAs('tester')); // an auth event → getMe, which fails
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(useSession.getState().status).toBe('ready');
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2)); // the quiet retry
    expect(path()).toBe('/settings');
    getMe.mockRestore();
  });

  it('a stale getMe (onboarded: false) cannot undo completeOnboarding', async () => {
    controls.signInAs('tester');
    controls.emptyUser();
    await launch();
    await screen.findByLabelText('Display name');
    const stale = await api.profile.getMe(); // onboarded: false
    let resolve!: (p: typeof stale) => void;
    const getMe = jest.spyOn(api.profile, 'getMe').mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await act(async () => controls.signInAs('tester')); // an auth event → getMe, held in flight
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await act(async () => useSession.getState().completeOnboarding());
    await act(async () => resolve(stale));
    expect(useSession.getState().status).toBe('ready');
    getMe.mockRestore();
  });

  it('a sign-out from anywhere lands on sign in', async () => {
    controls.signInAs('tester');
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
    await act(async () => controls.signInAs('tester'));
    await screen.findAllByText('Your feed');
    expect(result.getPathname()).toBe('/feed');
  });
});

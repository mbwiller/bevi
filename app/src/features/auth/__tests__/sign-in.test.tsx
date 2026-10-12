import path from 'path';

import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

const APP_DIR = path.resolve(__dirname, '../../../app');

async function open(url = '/sign-in') {
  useSession.setState({ status: 'signedOut', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: url });
  await result;
  await screen.findByLabelText('Username');
  return () => result.getPathname();
}

async function fill(username: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Username'), username);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

describe('sign in', () => {
  it('asks for both fields before calling the API', async () => {
    const spy = jest.spyOn(api, 'signIn');
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your username')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('signs in and the gate moves on to the feed', async () => {
    const spy = jest.spyOn(api, 'signIn');
    const path = await open();
    await fill('Tester ', 'tester-pass-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(spy).toHaveBeenCalledWith({ username: 'tester', password: 'tester-pass-1' });
    await screen.findAllByText('Your feed');
    expect(path()).toBe('/feed');
    expect(useSession.getState()).toMatchObject({ status: 'ready', profile: expect.objectContaining({ handle: 'tester' }) });
  });

  it('Enter in the username field moves on instead of submitting', async () => {
    const spy = jest.spyOn(api, 'signIn');
    await open();
    await fill('tester', 'tester-pass-1');
    await fireEvent(screen.getByLabelText('Username'), 'submitEditing', { nativeEvent: { text: 'tester' } });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText('Enter your password')).toBeNull();
  });

  it('Enter in the password field submits', async () => {
    const spy = jest.spyOn(api, 'signIn');
    await open();
    await fill('tester', 'tester-pass-1');
    await fireEvent(screen.getByLabelText('Password'), 'submitEditing', { nativeEvent: { text: 'tester-pass-1' } });
    expect(spy).toHaveBeenCalledWith({ username: 'tester', password: 'tester-pass-1' });
  });

  it('says so when the username or password is wrong', async () => {
    const path = await open();
    await fill('tester', 'nope-nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong username or password. Check them and try again.')).toBeTruthy();
    expect(path()).toBe('/sign-in');
  });

  it('shows an offline message and lets you try again', async () => {
    await open();
    controls.failNext('network', 'signIn');
    await fill('tester', 'tester-pass-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("You're offline. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findAllByText('Your feed');
  });

  it('links to sign up, with the admin reset hint and no reset flow', async () => {
    const path = await open();
    expect(screen.getByText('Forgot your password? Ask an admin to reset it.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(path()).toBe('/sign-up');
  });
});

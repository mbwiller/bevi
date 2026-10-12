import path from 'path';

import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

const APP_DIR = path.resolve(__dirname, '../../../app');
const WAIT = { timeout: 2000 };

async function open() {
  useSession.setState({ status: 'signedOut', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: '/sign-up' });
  await result;
  await screen.findByLabelText('Invite code');
  return () => result.getPathname();
}

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const create = () => fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

describe('sign up', () => {
  it('checks the username as you type: available, taken, reserved, bad characters', async () => {
    const check = jest.spyOn(api.profile, 'checkHandle');
    await open();
    await type('Username', 'Newbie');
    expect(await screen.findByText('@newbie is available', {}, WAIT)).toBeTruthy();
    expect(check).toHaveBeenLastCalledWith('newbie');

    await type('Username', 'tester');
    expect(await screen.findByText('That username is taken. Try another.', {}, WAIT)).toBeTruthy();

    check.mockClear();
    await type('Username', 'admin');
    expect(screen.getByText('That username is reserved. Try another.')).toBeTruthy();
    await type('Username', 'no spaces');
    expect(screen.getByText('Use only lowercase letters, numbers and _')).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it('shows what each field needs before calling the API', async () => {
    const spy = jest.spyOn(api, 'signUp');
    await open();
    await type('Username', 'ab');
    await type('Password', 'short');
    await create();
    expect(screen.getByText('Use 3–20 lowercase letters, numbers or _')).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters')).toBeTruthy();
    expect(screen.getByText('Enter your invite code')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('puts a wrong invite code on the invite field', async () => {
    await open();
    await type('Username', 'newbie');
    await type('Password', 'longenough');
    await type('Invite code', 'nope');
    await create();
    expect(await screen.findByText("That invite code isn't right. Check it with whoever invited you.")).toBeTruthy();
  });

  it('puts a taken username (conflict) on the username field', async () => {
    await open();
    controls.failNext('conflict', 'signUp');
    await type('Username', 'newbie');
    await type('Password', 'longenough');
    await type('Invite code', 'test-invite');
    await create();
    expect(await screen.findByText('That username is taken. Try another.')).toBeTruthy();
  });

  it('creates the account and the gate moves on to onboarding', async () => {
    const spy = jest.spyOn(api, 'signUp');
    const path = await open();
    await type('Username', 'newbie');
    await type('Password', 'longenough');
    await type('Invite code', ' test-invite ');
    await create();
    expect(spy).toHaveBeenCalledWith({ username: 'newbie', password: 'longenough', inviteCode: 'test-invite' });
    await screen.findByLabelText('Display name');
    expect(path()).toBe('/onboarding/profile');
    expect(useSession.getState().status).toBe('onboarding');
  });

  it('Enter moves through the fields; only the last one submits', async () => {
    const spy = jest.spyOn(api, 'signUp');
    await open();
    await type('Username', 'newbie');
    await type('Password', 'longenough');
    await type('Invite code', 'test-invite');
    for (const label of ['Username', 'Password']) {
      await fireEvent(screen.getByLabelText(label), 'submitEditing', { nativeEvent: { text: '' } });
    }
    expect(spy).not.toHaveBeenCalled();
    await fireEvent(screen.getByLabelText('Invite code'), 'submitEditing', { nativeEvent: { text: 'test-invite' } });
    expect(spy).toHaveBeenCalled();
  });

  it('links back to sign in', async () => {
    const path = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(path()).toBe('/sign-in');
  });
});

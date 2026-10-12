import path from 'path';

import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

const APP_DIR = path.resolve(__dirname, '../../../app');

/** A new account mid-onboarding: the test user, emptied (no birthdate, not onboarded). */
async function open(url: string) {
  controls.signInAs('tester');
  controls.emptyUser();
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: url });
  await result;
  return () => result.getPathname();
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

describe('onboarding: profile', () => {
  it('prefills the name, masks the birthdate and keeps Continue off until both are valid', async () => {
    await open('/onboarding/profile');
    const name = await screen.findByLabelText('Display name');
    const me = await api.profile.getMe();
    expect(name.props.value).toBe(me.displayName);
    expect(
      screen.getByText("Set once. Used only to show 21+ categories. Can't be changed later without contacting us."),
    ).toBeTruthy();
    expect(continueButton()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Birthdate'), '19900230');
    expect(screen.getByLabelText('Birthdate').props.value).toBe('1990-02-30');
    expect(screen.getByText('Enter a real date, like 1995-04-23')).toBeTruthy();
    expect(continueButton()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Birthdate'), '3000-01-01');
    expect(screen.getByText("That date hasn't happened yet")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Birthdate'), '1990-05-12');
    expect(continueButton()).toBeEnabled();

    await fireEvent.changeText(name, '  ');
    expect(screen.getByText('Enter a name')).toBeTruthy();
    expect(continueButton()).toBeDisabled();
  });

  it('notes that alcoholic categories stay hidden for under 21s', async () => {
    await open('/onboarding/profile');
    await screen.findByLabelText('Display name');
    const year = new Date().getFullYear() - 18;
    await fireEvent.changeText(screen.getByLabelText('Birthdate'), `${year}-01-01`);
    expect(screen.getByText(/under 21, so beer, wine and cocktail categories stay hidden/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Birthdate'), '1990-01-01');
    expect(screen.queryByText(/under 21/)).toBeNull();
  });

  it('saves the name with the device timezone, sets the birthdate once, then opens the starter step', async () => {
    const updateMe = jest.spyOn(api.profile, 'updateMe');
    const setBirthDate = jest.spyOn(api.profile, 'setBirthDate');
    const path = await open('/onboarding/profile');
    await fireEvent.changeText(await screen.findByLabelText('Display name'), 'Dee Mo');
    await fireEvent.changeText(screen.getByLabelText('Birthdate'), '19900512');
    await fireEvent.press(continueButton());
    await waitFor(() => expect(path()).toBe('/onboarding/starter'));
    expect(updateMe).toHaveBeenCalledWith({
      displayName: 'Dee Mo',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(setBirthDate).toHaveBeenCalledWith('1990-05-12');
    const me = await api.profile.getMe();
    expect(me).toMatchObject({ displayName: 'Dee Mo', birthdate: '1990-05-12', canSeeAlcohol: true });
  });

  it('shows an offline save under the form', async () => {
    await open('/onboarding/profile');
    await fireEvent.changeText(await screen.findByLabelText('Birthdate'), '19900512');
    controls.failNext('network', 'profile.updateMe');
    await fireEvent.press(continueButton());
    expect(await screen.findByText("You're offline. Check your connection and try again.")).toBeTruthy();
  });

  it('shows ErrorState with Retry when the profile fails to load', async () => {
    controls.setLatency(0);
    controls.signInAs('tester');
    controls.emptyUser();
    // 'unknown' isn't retried by the query client, so the error shows at once.
    controls.failNext('unknown', 'profile.getMe');
    useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/profile' });
    await fireEvent.press(await screen.findByText('Retry'));
    expect(await screen.findByLabelText('Display name')).toBeTruthy();
  });
});

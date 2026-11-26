import path from 'path';

import { configure, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls, ME, MINOR } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { pickableCategories } from '../selection';

const APP_DIR = path.resolve(__dirname, '../../../../app');

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(60000);

/**
 * The go-tos step mid-onboarding. `adult`: the test user emptied, then a 21+ birthdate set on the
 * profile step. Otherwise the under-21 fixture person. `before` runs signed in, before the render.
 */
async function open({ adult = true, before }: { adult?: boolean; before?: () => Promise<unknown> | void } = {}) {
  if (adult) {
    controls.signInAs(ME.handle);
    controls.emptyUser();
    await api.profile.setBirthDate('1990-05-12');
  } else {
    controls.signInAs(MINOR.handle);
  }
  await before?.();
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: '/onboarding/picks' });
  await result;
  await screen.findByRole('header', { name: 'What are your go-tos?' });
  return () => result.getPathname();
}

const tile = (name: string) => screen.getByRole('button', { name });
const continueButton = () => screen.getByRole('button', { name: 'Continue' });
const ALCOHOLIC = ['Beer', 'Wine', 'Spirits & cocktails'];

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

it('a 21+ user gets a tile for every category, the alcoholic three included, and no Other', async () => {
  await open();
  const labels = pickableCategories(true).map((c) => c.label);
  expect(labels).toHaveLength(14);
  for (const label of labels) expect(await screen.findByRole('button', { name: label })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
  expect(screen.getByText("Pick up to 3 kinds of Bev, favorite first. We'll start you with a few of each.")).toBeTruthy();
  expect(screen.getByText('Tap your number 1 first.')).toBeTruthy();
  expect(continueButton()).toBeDisabled();
});

it('someone who cannot see alcohol never gets beer, wine or spirits & cocktails', async () => {
  await open({ adult: false });
  expect((await api.profile.getMe()).canSeeAlcohol).toBe(false);
  for (const label of pickableCategories(false).map((c) => c.label)) {
    expect(await screen.findByRole('button', { name: label })).toBeTruthy();
  }
  for (const label of [...ALCOHOLIC, 'Other']) expect(screen.queryByRole('button', { name: label })).toBeNull();
});

it('the tap order becomes the numbers 1, 2, 3; a fourth tap changes nothing; un-picking renumbers', async () => {
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Coffee' }));
  expect(tile('Coffee, your number 1 pick').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText('Pick up to 2 more, or continue.')).toBeTruthy();
  expect(continueButton()).toBeEnabled();

  await fireEvent.press(tile('Tea'));
  expect(screen.getByText('Pick 1 more, or continue.')).toBeTruthy();
  await fireEvent.press(tile('Boba'));
  expect(tile('Coffee, your number 1 pick')).toBeTruthy();
  expect(tile('Tea, your number 2 pick')).toBeTruthy();
  expect(tile('Boba, your number 3 pick')).toBeTruthy();
  expect(screen.getByText("That's your 3. Tap one to swap it out.")).toBeTruthy();

  // Full: every other tile is dimmed and says so; tapping one changes nothing.
  const soda = tile("Soda. You've picked 3 already");
  expect(soda.props.accessibilityState).toMatchObject({ selected: false, disabled: true });
  await fireEvent.press(soda);
  expect(tile("Soda. You've picked 3 already")).toBeTruthy();
  expect(tile('Boba, your number 3 pick')).toBeTruthy();

  // Dropping the favorite moves the others up one, and the rest come back.
  await fireEvent.press(tile('Coffee, your number 1 pick'));
  expect(tile('Tea, your number 1 pick')).toBeTruthy();
  expect(tile('Boba, your number 2 pick')).toBeTruthy();
  expect(tile('Coffee').props.accessibilityState).toMatchObject({ selected: false, disabled: false });
  expect(tile('Soda')).toBeTruthy();

  // Back to none: Continue turns off again.
  await fireEvent.press(tile('Tea, your number 1 pick'));
  await fireEvent.press(tile('Boba, your number 1 pick'));
  expect(continueButton()).toBeDisabled();
  expect(screen.getByText('Tap your number 1 first.')).toBeTruthy();
});

it('Continue saves the picks in tap order, then opens the starter ranking', async () => {
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  const pathname = await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Wine' }));
  await fireEvent.press(tile('Juice'));
  await fireEvent.press(tile('Sparkling water'));
  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(await api.profile.getCategoryPicks()).toEqual(['wine', 'juice', 'sparkling_water']);
});

it('a returning user sees their saved picks in order, and Continue without a change saves nothing', async () => {
  const pathname = await open({ before: () => api.profile.setCategoryPicks(['tea', 'coffee']) });
  expect(await screen.findByRole('button', { name: 'Tea, your number 1 pick' })).toBeTruthy();
  expect(tile('Coffee, your number 2 pick')).toBeTruthy();
  expect(screen.getByText('Pick 1 more, or continue.')).toBeTruthy();
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).not.toHaveBeenCalled();
});

it('a saved category that is not offered now drops out of the pre-fill, and Continue saves what is shown', async () => {
  const pathname = await open({ before: () => api.profile.setCategoryPicks(['other', 'tea']) });
  expect(await screen.findByRole('button', { name: 'Tea, your number 1 pick' })).toBeTruthy();
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).toHaveBeenCalledWith(['tea']);
});

it('a failed save keeps the picks on screen with the error under them; Continue tries again', async () => {
  const pathname = await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Coffee' }));
  controls.failNext('network', 'profile.setCategoryPicks');
  await fireEvent.press(continueButton());
  expect(await screen.findByText("You're offline. Check your connection and try again.")).toBeTruthy();
  expect(pathname()).toBe('/onboarding/picks');
  expect(tile('Coffee, your number 1 pick')).toBeTruthy();
  expect(await api.profile.getCategoryPicks()).toEqual([]);

  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(await api.profile.getCategoryPicks()).toEqual(['coffee']);
});

it('the tiles still render, with their category art, when the starter candidates fail', async () => {
  controls.failNext('unknown', 'bevs.getStarterCandidates');
  await open();
  for (const label of pickableCategories(true).map((c) => c.label)) {
    expect(await screen.findByRole('button', { name: label })).toBeTruthy();
  }
  expect(screen.queryByText('Retry')).toBeNull();
  await fireEvent.press(tile('Smoothie'));
  expect(tile('Smoothie, your number 1 pick')).toBeTruthy();
});

it('a failed load of the saved picks shows Retry, then the tiles', async () => {
  controls.signInAs(ME.handle);
  controls.emptyUser();
  controls.failNext('unknown', 'profile.getCategoryPicks');
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/picks' });
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByRole('button', { name: 'Coffee' })).toBeTruthy();
});

it('Back returns to the profile step', async () => {
  controls.signInAs(ME.handle);
  controls.emptyUser();
  useSession.setState({ status: 'onboarding', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl: '/onboarding/profile' });
  await result;
  await fireEvent.changeText(await screen.findByLabelText('Birthdate'), '19900512');
  await fireEvent.press(continueButton());
  await screen.findByRole('header', { name: 'What are your go-tos?' });
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(result.getPathname()).toBe('/onboarding/profile'));
});

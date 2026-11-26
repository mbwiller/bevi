import path from 'path';

import type { ApiErrorCode, BevSummary, Profile } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { act, configure, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { AccessibilityInfo } from 'react-native';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import { controls, ME, MINOR } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { PicksScreen } from '../PicksScreen';
import { artBevsByCategory, pickableCategories } from '../selection';

const APP_DIR = path.resolve(__dirname, '../../../../app');

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(60000);

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] };
type NavState = { routes: { name: string; state?: NavState }[] };

/** Every host element under `el`, itself included. */
function hosts(el: Host | string): Host[] {
  return typeof el === 'string' ? [] : [el, ...el.children.flatMap(hosts)];
}

/**
 * What a tile's art shows: the image URL it loads (a starter Bev's icon or photo, through expo-image),
 * and whether it draws a BevArt (the category's own art: react-native-svg's view with BevArt's
 * 100 x 100 viewBox; BevImage's own glow has none).
 */
function tileArt(name: string): { uri: string | undefined; bevArt: boolean } {
  const art = within(screen.getByRole('button', { name })).getByTestId('pick-art', { includeHiddenElements: true });
  const all = hosts(art as unknown as Host);
  const source = all.map((h) => h.props.source as { uri?: string }[] | undefined).find(Boolean);
  return {
    uri: source?.[0]?.uri,
    bevArt: all.some((h) => h.type === 'RNSVGSvgView' && h.props.vbWidth === 100),
  };
}

/** How many times a route sits in the navigation state, at any depth. */
function routeCount(state: NavState | undefined, name: string): number {
  return (state?.routes ?? []).reduce((n, r) => n + (r.name === name ? 1 : 0) + routeCount(r.state, name), 0);
}

let routerState: () => NavState | undefined = () => undefined;

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
  routerState = () => result.getRouterState() as NavState | undefined;
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

it('a returning user sees their saved picks in order; Continue saves them again, then opens the starter ranking', async () => {
  const pathname = await open({ before: () => api.profile.setCategoryPicks(['tea', 'coffee']) });
  expect(await screen.findByRole('button', { name: 'Tea, your number 1 pick' })).toBeTruthy();
  expect(tile('Coffee, your number 2 pick')).toBeTruthy();
  expect(screen.getByText('Pick 1 more, or continue.')).toBeTruthy();
  // The cached list may be stale, so an unchanged selection is still sent, and the starter screen
  // reads what the server answered.
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(['tea', 'coffee']);
  expect(await api.profile.getCategoryPicks()).toEqual(['tea', 'coffee']);
});

it('two presses of Continue inside one frame save once and open the starter ranking once', async () => {
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  const pathname = await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Coffee' }));
  // Two presses before React renders again, as two taps inside one frame are: the button has not
  // turned to its loading state for the second. React Native's Pressable turns a click into onPress
  // (the path an accessibility tap takes); calling it twice in one act keeps the render back.
  const click = continueButton().props.onClick as (event: object) => void;
  await act(async () => {
    click({ nativeEvent: {} });
    click({ nativeEvent: {} });
  });
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(routeCount(routerState(), 'onboarding/starter')).toBe(1);
});

it('a saved alcoholic pick drops out of the pre-fill for someone who cannot see alcohol', async () => {
  const pathname = await open({
    before: async () => {
      // Saved while 21+; the profile now says otherwise.
      await api.profile.setCategoryPicks(['wine', 'tea']);
      const real = api.profile.getMe.bind(api.profile);
      jest.spyOn(api.profile, 'getMe').mockImplementation(async () => ({ ...(await real()), canSeeAlcohol: false }));
    },
  });
  expect(await screen.findByRole('button', { name: 'Tea, your number 1 pick' })).toBeTruthy();
  for (const label of ALCOHOLIC) expect(screen.queryByRole('button', { name: new RegExp(`^${label}`) })).toBeNull();
  expect(screen.getByText('Pick up to 2 more, or continue.')).toBeTruthy();
  const save = jest.spyOn(api.profile, 'setCategoryPicks');
  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(save).toHaveBeenCalledWith(['tea']);
});

describe('when the profile changes while the screen is open', () => {
  let client: QueryClient;
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <Slot />
      </QueryClientProvider>
    );
  }
  const Stub = () => null;

  it('a flip of canSeeAlcohol starts the picks again, so nothing hidden stays picked or is saved', async () => {
    controls.signInAs(ME.handle);
    controls.emptyUser();
    await api.profile.setBirthDate('1990-05-12');
    await api.profile.setCategoryPicks(['wine', 'tea']);
    // A client the test can write the profile into, as a refetch would.
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const result = renderRouter(
      { _layout: Layout, 'onboarding/picks': PicksScreen, 'onboarding/starter': Stub },
      { initialUrl: '/onboarding/picks' },
    );
    await result;
    expect(await screen.findByRole('button', { name: 'Wine, your number 1 pick' })).toBeTruthy();
    expect(tile('Tea, your number 2 pick')).toBeTruthy();

    const me = client.getQueryData<Profile>(keys.me())!;
    await act(async () => {
      client.setQueryData<Profile>(keys.me(), { ...me, canSeeAlcohol: false });
    });
    expect(await screen.findByRole('button', { name: 'Tea, your number 1 pick' })).toBeTruthy();
    for (const label of ALCOHOLIC) expect(screen.queryByRole('button', { name: new RegExp(`^${label}`) })).toBeNull();

    const save = jest.spyOn(api.profile, 'setCategoryPicks');
    await fireEvent.press(continueButton());
    await waitFor(() => expect(result.getPathname()).toBe('/onboarding/starter'));
    expect(save).toHaveBeenCalledWith(['tea']);
  });
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

// What `formErrorMessage` makes of each: the error copy's title and message, as on the profile step.
it.each<[ApiErrorCode, string]>([
  ['validation', "That didn't go through. Check the details and try again."],
  ['age_restricted', "Not available. This isn't available on your account."],
  ['unauthorized', "You're signed out. Sign in again to pick up where you left off."],
])('a save refused with %s keeps the picks, says so under them, and Continue tries again', async (code, line) => {
  const pathname = await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Coffee' }));
  await fireEvent.press(tile('Tea'));
  controls.failNext(code, 'profile.setCategoryPicks');
  await fireEvent.press(continueButton());
  expect(await screen.findByText(line)).toBeTruthy();
  expect(pathname()).toBe('/onboarding/picks');
  expect(tile('Coffee, your number 1 pick')).toBeTruthy();
  expect(tile('Tea, your number 2 pick')).toBeTruthy();
  expect(continueButton()).toBeEnabled();
  expect(await api.profile.getCategoryPicks()).toEqual([]);
  // Nothing on this screen signs anyone out: the session moves only on an auth event or a failed getMe.
  expect(useSession.getState().status).toBe('onboarding');

  await fireEvent.press(continueButton());
  await waitFor(() => expect(pathname()).toBe('/onboarding/starter'));
  expect(await api.profile.getCategoryPicks()).toEqual(['coffee', 'tea']);
});

it("each tile shows its category's most-rated starter Bev once the candidates are in", async () => {
  // The fake serves no icons, so give the most-rated coffee starter one, as the real catalogue has.
  const real = api.bevs.getStarterCandidates.bind(api.bevs);
  let coffee: BevSummary | undefined;
  jest.spyOn(api.bevs, 'getStarterCandidates').mockImplementation(async () => {
    const candidates = await real();
    coffee = artBevsByCategory(candidates).get('coffee');
    return candidates.map((c) => (c.id === coffee?.id ? { ...c, iconUrl: `https://fake.bevi.test/bev-icons/${c.id}.png` } : c));
  });
  await open();
  await waitFor(() => expect(tileArt('Coffee').uri).toBe(`https://fake.bevi.test/bev-icons/${coffee!.id}.png`));
  expect(tileArt('Coffee').bevArt).toBe(false);
  // A starter with no icon or photo falls through bevImageProps to its category's art.
  expect(tileArt('Tea')).toEqual({ uri: undefined, bevArt: true });
});

it('the tiles still render, with their category art, when the starter candidates fail', async () => {
  controls.failNext('unknown', 'bevs.getStarterCandidates');
  await open();
  for (const label of pickableCategories(true).map((c) => c.label)) {
    expect(await screen.findByRole('button', { name: label })).toBeTruthy();
    expect(tileArt(label)).toEqual({ uri: undefined, bevArt: true });
  }
  expect(screen.queryByText('Retry')).toBeNull();
  await fireEvent.press(tile('Smoothie'));
  expect(tile('Smoothie, your number 1 pick')).toBeTruthy();
});

it('says the full state aloud when the third pick lands, and nothing before', async () => {
  // React Native's own mock keeps calls from earlier tests in this file; start from none.
  const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  await open();
  said.mockClear();
  await fireEvent.press(await screen.findByRole('button', { name: 'Coffee' }));
  await fireEvent.press(tile('Tea'));
  expect(said).not.toHaveBeenCalled();
  await fireEvent.press(tile('Boba'));
  expect(said).toHaveBeenCalledWith("That's your 3. Tap one to swap it out.");
  expect(said).toHaveBeenCalledTimes(1);
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

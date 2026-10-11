import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import ProfileScreen from '@/app/(tabs)/profile/index';
import UserProfileScreen from '@/app/user/[id]/index';

const controls = mockControls!;
let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function open(url: string) {
  const result = renderRouter(
    {
      _layout: Layout,
      '(tabs)/profile/index': ProfileScreen,
      'user/[id]/index': UserProfileScreen,
      'user/[id]/followers': Stub,
      'user/[id]/following': Stub,
      '(tabs)/lists/index': Stub,
      '(tabs)/add/index': Stub,
      'bev/[id]': Stub,
      'settings/index': Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
});

// Let optimistic mutations and their refetches finish before the next test renders.
afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

describe('own profile', () => {
  it('shows the hero, counts, list rows, stat cards and your rankings', async () => {
    const me = await api.profile.getMe();
    const stats = await api.stats.getMine();
    const latest = (await api.rankings.listUser(me.id)).items[0]!;
    const r = await open('/profile');

    expect(await screen.findByText(`@${me.handle}`)).toBeTruthy();
    expect(screen.getByText(me.displayName)).toBeTruthy();
    expect(screen.getByLabelText(`${stats.followers} Followers`)).toBeTruthy();
    expect(screen.getByLabelText(`Bev'd, ${stats.bevdCount}`)).toBeTruthy();
    expect(screen.getByLabelText(`Want to Try, ${stats.wantToTryCount}`)).toBeTruthy();
    expect(screen.getByLabelText('Recommended for you')).toBeTruthy();
    expect(screen.getByLabelText(`Rank on Bevi, #${stats.rankOnBevi} · ${stats.rankPoints} pts`)).toBeTruthy();
    // Streaks aren't computed yet (the mock returns 0).
    expect(screen.getByLabelText('Current streak, Rank today to start')).toBeTruthy();
    expect((await screen.findAllByText(latest.bev.name)).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByLabelText(`Want to Try, ${stats.wantToTryCount}`));
    expect(r.path()).toBe('/lists?tab=want');
  });

  it('opens your followers from the count', async () => {
    const me = await api.profile.getMe();
    const stats = await api.stats.getMine();
    const r = await open('/profile');
    await fireEvent.press(await screen.findByLabelText(`${stats.followers} Followers`));
    expect(r.path()).toBe(`/user/${me.id}/followers`);
  });

  it('a brand-new user sees zeros, Unranked and the Activity empty state', async () => {
    controls.emptyUser();
    await open('/profile');
    expect(await screen.findByText('Your rankings will show up here')).toBeTruthy();
    expect(screen.getByLabelText("Bev'd, 0")).toBeTruthy();
    expect(screen.getByLabelText('Rank on Bevi, Unranked')).toBeTruthy();
    expect(screen.getByLabelText('Current streak, Rank today to start')).toBeTruthy();
  });

  it('Taste Profile is coming soon', async () => {
    await open('/profile?tab=taste');
    expect(await screen.findByText('Coming soon')).toBeTruthy();
  });

  it('edits the display name in the sheet; the username is read-only', async () => {
    await open('/profile');
    await fireEvent.press(await screen.findByLabelText('Edit profile'));
    const sheet = await screen.findByTestId('sheet');
    const name = within(sheet).getByLabelText('Name');
    expect(within(sheet).getByLabelText('Username').props.editable).toBe(false);
    await fireEvent.changeText(name, '  ');
    await fireEvent.press(within(sheet).getByLabelText('Save'));
    expect(await within(sheet).findByText('Enter a name.')).toBeTruthy();
    await fireEvent.changeText(name, 'Demo Renamed');
    await fireEvent.press(within(sheet).getByLabelText('Save'));
    await waitFor(async () => expect((await api.profile.getMe()).displayName).toBe('Demo Renamed'));
    expect(await screen.findByText('Demo Renamed')).toBeTruthy();
  });
});

describe("another user's profile", () => {
  async function jules() {
    const page = await api.profile.searchUsers({ q: 'jules' });
    return page.items.find((u) => u.handle === 'jules')!;
  }

  it('follow toggles optimistically and the count follows', async () => {
    const j = await jules();
    if (j.isFollowing) await api.follows.unfollow(j.id);
    const before = (await api.stats.getUser(j.id)).followers;
    await open(`/user/${j.id}`);
    const button = await screen.findByLabelText(`Follow ${j.displayName}`);
    expect(button.props['aria-pressed']).toBe(false);
    expect(screen.getByLabelText(`${before} Followers`)).toBeTruthy();

    controls.setLatency(800);
    await fireEvent.press(button);
    // Optimistic: flipped well before the 800ms call resolves.
    await waitFor(() => expect(screen.getByLabelText(`Follow ${j.displayName}`).props['aria-pressed']).toBe(true), { timeout: 400 });
    expect(screen.getByLabelText(`${before + 1} Followers`)).toBeTruthy();
    controls.setLatency(0);
    await waitFor(async () => expect((await api.profile.getUser(j.id)).isFollowing).toBe(true));

    await fireEvent.press(screen.getByLabelText(`Follow ${j.displayName}`));
    await waitFor(() => expect(screen.getByLabelText(`Follow ${j.displayName}`).props['aria-pressed']).toBe(false));
    await waitFor(async () => expect((await api.profile.getUser(j.id)).isFollowing).toBe(false));
  });

  it('rolls back when the follow fails', async () => {
    const j = await jules();
    if (j.isFollowing) await api.follows.unfollow(j.id);
    await open(`/user/${j.id}`);
    const button = await screen.findByLabelText(`Follow ${j.displayName}`);
    controls.failNext('network', 'follows.follow');
    await fireEvent.press(button);
    await waitFor(() => expect(screen.getByLabelText(`Follow ${j.displayName}`).props['aria-pressed']).toBe(false));
  });

  it('shows their rankings and no Recommended row', async () => {
    const j = await jules();
    const latest = (await api.rankings.listUser(j.id)).items[0]!;
    await open(`/user/${j.id}`);
    expect((await screen.findAllByText(latest.bev.name)).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Recommended for you')).toBeNull();
    expect(screen.queryByLabelText('Edit profile')).toBeNull();
  });

  it('not_found', async () => {
    await open('/user/no-such-user');
    expect(await screen.findByText("This person isn't on Bevi anymore")).toBeTruthy();
  });

  it('your own id redirects to the Profile tab', async () => {
    const me = await api.profile.getMe();
    const r = await open(`/user/${me.id}`);
    await waitFor(() => expect(r.path()).toBe('/profile'));
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { useRemoveRanking } from '@/api/hooks';
import { keys } from '@/api/keys';
import ProfileScreen from '@/app/(tabs)/profile/index';
import UserProfileScreen from '@/app/user/[id]/index';
import { FRIEND, MINOR, ME, controls, userIdFor } from '@/testing/fakeApi';

let client: QueryClient;

/** The app's own removal mutation (with its invalidation), driven from the test. */
let removeRanking: ReturnType<typeof useRemoveRanking>['mutateAsync'];
function Remover() {
  removeRanking = useRemoveRanking().mutateAsync;
  return null;
}

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Remover />
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function open(url: string) {
  await renderRouter(
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
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

const bar = (label: RegExp | string) => screen.findByLabelText(label);
const bars = () => screen.queryAllByLabelText(/, average \d/).map((n) => n.props.accessibilityLabel as string);

describe('Profile › Taste Profile', () => {
  it('your own tab shows a bar per category, highest first, and no read-out under a 1.0 gap', async () => {
    await open('/profile?tab=taste');
    await bar(/^Coffee, average/);
    const mine = await api.stats.getTasteProfile(userIdFor(ME.handle));
    expect(bars()).toEqual(mine.map((r) => expect.stringMatching(new RegExp(`average ${r.mean.toFixed(1)}, ${r.rankingCount} ranked$`))));
    expect(bars()[0]).toMatch(/^Coffee, average 8\.1, 8 ranked$/);
    expect(bars()[1]).toMatch(/^Soda, average 7\.1, 4 ranked$/);
    expect(screen.queryByText(/You prefer/)).toBeNull();
    expect(screen.queryByText('Coming soon')).toBeNull();
  });

  it('is reachable from the tab itself, not only the deep link', async () => {
    await open('/profile');
    await fireEvent.press(await screen.findByLabelText('Taste Profile'));
    await bar(/^Coffee, average/);
  });

  it('writes the read-out in the first person on your own profile', async () => {
    controls.signInAs(FRIEND.handle);
    await open('/profile?tab=taste');
    // Soda 8.2 (42 ranked), juice 6.5 (3), energy 6.3 (10): the read-out names the highest and the
    // lowest. A-13's six catalog corrections moved four Bevs into `soda` and one out of `juice`,
    // and the fixture generator weights its picks by category, so which Bevs this user ranks --
    // and therefore which category is lowest -- moved with them. It was juice before A-13.
    expect(await screen.findByText('You prefer soda over energy')).toBeTruthy();
    expect(bars()).toHaveLength(3);
  });

  it("another user's tab shows their bars and a read-out with their first name", async () => {
    await open(`/user/${userIdFor('friend_e')}?tab=taste`);
    expect(await screen.findByText('Friend prefers beer and wine over spirits & cocktails')).toBeTruthy();
    await bar(/^Beer, average 8\.5, 11 ranked$/);
    await bar(/^Diet soda, average 7\.6, 20 ranked$/);
  });

  it('shows Skeleton rows while loading', async () => {
    controls.setLatency(300);
    await open('/profile?tab=taste');
    expect(await screen.findByTestId('taste-skeleton')).toBeTruthy();
    await bar(/^Coffee, average/);
    expect(screen.queryByTestId('taste-skeleton')).toBeNull();
  });

  it('shows an ErrorState with Retry, and Retry loads the bars', async () => {
    controls.failNext('network', 'stats.getTasteProfile');
    await open('/profile?tab=taste');
    const retry = await screen.findByText('Retry');
    await fireEvent.press(retry);
    await bar(/^Coffee, average/);
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('your own empty state offers to rank a first Bev', async () => {
    controls.emptyUser();
    await open('/profile?tab=taste');
    expect(await screen.findByText('No taste profile yet')).toBeTruthy();
    expect(screen.getByText('Rank your first Bev')).toBeTruthy();
    expect(bars()).toHaveLength(0);
  });

  it("someone else's empty state", async () => {
    const spy = jest.spyOn(api.stats, 'getTasteProfile').mockResolvedValue([]);
    await open(`/user/${userIdFor(FRIEND.handle)}?tab=taste`);
    expect(await screen.findByText('Their taste profile will show up here.')).toBeTruthy();
    expect(screen.getByText('No taste profile yet')).toBeTruthy();
    spy.mockRestore();
  });

  it('an under-21 viewer never sees beer, wine or spirits rows', async () => {
    controls.signInAs(MINOR.handle);
    await open(`/user/${userIdFor('friend_e')}?tab=taste`);
    await bar(/^Diet soda, average/);
    expect(bars().join('\n')).not.toMatch(/Beer|Wine|Spirits/);
    expect(screen.queryByText(/spirits|beer|wine/i)).toBeNull();
  });

  it('drops alcoholic rows client-side even if the server sent them', async () => {
    controls.signInAs(MINOR.handle);
    const spy = jest.spyOn(api.stats, 'getTasteProfile').mockResolvedValue([
      { categoryId: 'beer', rankingCount: 9, mean: 9, affinity: 1 },
      { categoryId: 'coffee', rankingCount: 5, mean: 7, affinity: 0 },
      { categoryId: 'wine', rankingCount: 5, mean: 6, affinity: 0 },
      { categoryId: 'soda', rankingCount: 5, mean: 5, affinity: 0 },
    ]);
    await open('/profile?tab=taste');
    await bar(/^Coffee, average 7\.0/);
    expect(bars()).toEqual(['Coffee, average 7.0, 5 ranked', 'Soda, average 5.0, 5 ranked']);
    // The read-out is computed on what is shown: coffee vs soda, not beer vs wine.
    expect(screen.getByText('You prefer coffee over soda')).toBeTruthy();
    spy.mockRestore();
  });

  it('refreshes after a ranking is removed', async () => {
    await open('/profile?tab=taste');
    await bar(/^Soda, average 7\.1, 4 ranked$/);
    const soda = (await api.rankings.listMine({ categoryId: 'soda' })).items;
    await removeRanking(soda[0]!.bev.id);
    await bar(/^Soda, average .*, 3 ranked$/);
    expect(client.getQueryState(keys.stats.tasteProfile(userIdFor(ME.handle)))?.isInvalidated).toBe(false);
  });
});

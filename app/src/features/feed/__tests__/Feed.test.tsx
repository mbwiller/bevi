import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import FeedScreen from '@/app/(tabs)/feed/index';

import { featuredSubtitle } from '../FeaturedCarousel';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url = '/feed') {
  const result = renderRouter(
    {
      _layout: Layout,
      'feed/index': FeedScreen,
      'bev/[id]': Stub,
      'rank/[bevId]': Stub,
      'user/[id]/index': Stub,
      'profile/index': Stub,
      'add/index': Stub,
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
  controls.signInAs('tester');
});

afterEach(() => client.clear());

it('renders the featured carousel and the feed posts', async () => {
  const featured = await api.feed.getFeatured();
  const feed = await api.feed.getFeed({ limit: 20 });
  expect(featured.length).toBeGreaterThan(0);
  expect(feed.items.length).toBeGreaterThan(0);
  await start();

  const first = featured[0]!;
  const carousel = await screen.findByTestId('featured-carousel');
  expect(await within(carousel).findByLabelText(`${first.bev.name}, ${featuredSubtitle(first)}`)).toBeTruthy();

  const post = feed.items.find((p) => p.type === 'RANKING')!;
  expect((await screen.findAllByText(post.bev.name)).length).toBeGreaterThan(0);
  expect(screen.getByText('Your feed')).toBeTruthy();
  expect(screen.queryByText('Follow friends to see their Bevs')).toBeNull();
});

it("opens the actor's profile from a post", async () => {
  const feed = await api.feed.getFeed({ limit: 20 });
  const me = await api.profile.getMe();
  const post = feed.items.find((p) => p.actor.id !== me.id)!;
  const r = await start();

  await fireEvent.press((await screen.findAllByLabelText(`${post.actor.displayName}, @${post.actor.handle}`))[0]!);
  expect(r.path()).toBe(`/user/${post.actor.id}`);
});

it('opens the Bev from a post', async () => {
  const feed = await api.feed.getFeed({ limit: 20 });
  const post = feed.items.find((p) => p.type === 'RANKING')!;
  const r = await start();
  await fireEvent.press((await screen.findAllByLabelText(`Open ${post.bev.name}`))[0]!);
  expect(r.path()).toBe(`/bev/${post.bev.id}`);
});

it('the search bar opens Add Bev', async () => {
  const r = await start();
  await fireEvent.press(await screen.findByRole('search'));
  expect(r.path()).toBe('/add');
});

it('following nobody: the follow empty state under YOUR FEED, Featured stays', async () => {
  controls.emptyUser();
  const r = await start();
  expect(await screen.findByText('Follow friends to see their Bevs')).toBeTruthy();
  expect(await screen.findByTestId('featured-carousel')).toBeTruthy();
  // The header's icon and the empty state's pill both say Find people; press the pill.
  const buttons = screen.getAllByLabelText('Find people');
  expect(buttons).toHaveLength(2);
  await fireEvent.press(buttons[1]!);
  expect(r.path()).toBe('/add?tab=people');
});

it('saves to Want to Try optimistically, and rolls back on error', async () => {
  const feed = await api.feed.getFeed({ limit: 20 });
  const target = feed.items.findIndex((p) => !p.inMyWantToTry);
  expect(target).toBeGreaterThanOrEqual(0);
  await start();
  await screen.findByText('Your feed');
  await screen.findAllByLabelText(/^Save to Want to Try$|^Saved to Want to Try$/);

  const saveButtons = () => screen.getAllByLabelText(/^Save(d)? to Want to Try$/);
  const before = saveButtons().filter((b) => b.props['aria-pressed']).length;

  controls.setLatency(400);
  controls.failNext('network', 'wantToTry.add');
  await fireEvent.press(screen.getAllByLabelText('Save to Want to Try')[0]!);
  // Filled before the server answers…
  await waitFor(() => expect(saveButtons().filter((b) => b.props['aria-pressed']).length).toBeGreaterThan(before), { timeout: 300 });
  // …and back when it fails.
  await waitFor(() => expect(saveButtons().filter((b) => b.props['aria-pressed']).length).toBe(before), { timeout: 3000 });
});

it('shows ErrorState with Retry when the feed fails', async () => {
  controls.failNext('network', 'feed.getFeed');
  await start();
  const retry = await screen.findByLabelText('Retry');
  controls.setLatency(0);
  await fireEvent.press(retry);
  expect(await screen.findByText('Your feed')).toBeTruthy();
  await waitFor(() => expect(screen.queryByLabelText('Retry')).toBeNull());
});

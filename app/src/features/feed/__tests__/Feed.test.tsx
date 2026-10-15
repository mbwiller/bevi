import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import { likeLabel } from '@/components/LikeButton';
import { keys } from '@/api/keys';
import { formatRelativeTime } from '@/lib/time';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';
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

describe('likes', () => {
  /** A post by FRIEND, whom ME follows: both can see (and like) it. */
  async function friendsPost(): Promise<FeedItem> {
    const feed = await api.feed.getFeed({ limit: 20 });
    const post = feed.items.find((p) => p.actor.id === userIdFor(FRIEND.handle) && !p.likedByMe);
    expect(post).toBeDefined();
    return post!;
  }

  /** The post's heart, found by its accessible name ("Like", "Unlike, 2 likes"). */
  const heart = (post: FeedItem, name: string | RegExp) =>
    within(screen.getByTestId(`feed-post-${post.id}`)).getByRole('button', { name });

  async function serverSide(post: FeedItem) {
    const feed = await api.feed.getFeed({ limit: 20 });
    const p = feed.items.find((x) => x.id === post.id)!;
    return { liked: p.likedByMe, count: p.likeCount };
  }

  it('likes and unlikes from the heart: the heart fills, the count moves, the server agrees', async () => {
    // Someone else's like first, so the count starts at 1.
    const post = await friendsPost();
    controls.signInAs(FRIEND.handle);
    await api.feed.like(post.id);
    controls.signInAs(ME.handle);
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    const like = heart(post, 'Like, 1 like');
    expect(like.props['aria-pressed']).toBe(false);
    await fireEvent.press(like);
    const unlike = await waitFor(() => heart(post, 'Unlike, 2 likes'));
    expect(unlike.props['aria-pressed']).toBe(true);
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: true, count: 2 }));

    await fireEvent.press(unlike);
    expect((await waitFor(() => heart(post, 'Like, 1 like'))).props['aria-pressed']).toBe(false);
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: false, count: 1 }));
  });

  it('a double-tap on the post likes it', async () => {
    const post = await friendsPost();
    await start();
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    const when = within(card).getByText(formatRelativeTime(post.createdAt));
    await fireEvent.press(when);
    await fireEvent.press(when);
    expect((await waitFor(() => heart(post, 'Unlike, 1 like'))).props['aria-pressed']).toBe(true);
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: true, count: 1 }));
  });

  it('rolls back and says so when the like fails', async () => {
    const post = await friendsPost();
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    controls.setLatency(400);
    controls.failNext('network', 'feed.like');
    await fireEvent.press(heart(post, 'Like'));
    // Filled before the server answers…
    await waitFor(() => expect(heart(post, 'Unlike, 1 like').props['aria-pressed']).toBe(true), { timeout: 300 });
    // …and back when it fails, with the reason on the post.
    await waitFor(() => expect(heart(post, 'Like').props['aria-pressed']).toBe(false), { timeout: 3000 });
    const card = screen.getByTestId(`feed-post-${post.id}`);
    expect(within(card).getByText("Couldn't like this post. Check your connection and try again.")).toBeTruthy();
    controls.setLatency(0);
    expect(await serverSide(post)).toEqual({ liked: false, count: 0 });
  });

  it('rate_limited: the heart goes back and the post says to wait', async () => {
    const post = await friendsPost();
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    controls.failNext('rate_limited', 'feed.like');
    await fireEvent.press(heart(post, 'Like'));
    const card = screen.getByTestId(`feed-post-${post.id}`);
    expect(await within(card).findByText("Couldn't like this post. Wait a minute, then try again.")).toBeTruthy();
    expect(heart(post, 'Like').props['aria-pressed']).toBe(false);
    // The next tap clears the message and goes through.
    await fireEvent.press(heart(post, 'Like'));
    await waitFor(() => expect(within(card).queryByText(/Couldn't like this post/)).toBeNull());
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: true, count: 1 }));
  });

  it('a feed refetch that lands mid-like with the old state does not undo the like', async () => {
    const post = await friendsPost();
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    controls.setLatency(300);
    await fireEvent.press(heart(post, 'Like'));
    await waitFor(() => expect(heart(post, 'Unlike, 1 like').props['aria-pressed']).toBe(true), { timeout: 250 });
    // What a refetch started before the server applied the like would write: the pre-tap post.
    client.setQueriesData({ queryKey: keys.feed() }, (data: unknown) => {
      const d = data as { pages: { items: FeedItem[] }[] } | undefined;
      if (!d?.pages) return data;
      return {
        ...d,
        pages: d.pages.map((p) => ({
          ...p,
          items: p.items.map((i) => (i.id === post.id ? { ...i, likedByMe: false, likeCount: 0 } : i)),
        })),
      };
    });
    await waitFor(() => expect(heart(post, 'Like').props['aria-pressed']).toBe(false));
    // When the like settles, the confirmed state is written back over it.
    await waitFor(() => expect(heart(post, 'Unlike, 1 like').props['aria-pressed']).toBe(true), { timeout: 3000 });
    controls.setLatency(0);
    expect(await serverSide(post)).toEqual({ liked: true, count: 1 });
  });

  it('an earlier failed tap does not undo a later successful one', async () => {
    const post = await friendsPost();
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    controls.setLatency(150);
    controls.failNext('network', 'feed.like');
    await fireEvent.press(heart(post, 'Like')); // like: fails
    await fireEvent.press(await waitFor(() => heart(post, 'Unlike, 1 like'))); // unlike
    await fireEvent.press(await waitFor(() => heart(post, 'Like'))); // like: succeeds
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: true, count: 1 }), { timeout: 3000 });
    expect(heart(post, 'Unlike, 1 like').props['aria-pressed']).toBe(true);
    const card = screen.getByTestId(`feed-post-${post.id}`);
    expect(within(card).queryByText(/Couldn't like this post/)).toBeNull();
  });

  it('rapid taps end in the state of the last tap', async () => {
    const post = await friendsPost();
    await start();
    await screen.findByTestId(`feed-post-${post.id}`);

    controls.setLatency(150);
    await fireEvent.press(heart(post, 'Like')); // like
    await fireEvent.press(await waitFor(() => heart(post, 'Unlike, 1 like'))); // unlike
    await fireEvent.press(await waitFor(() => heart(post, 'Like'))); // like
    expect((await waitFor(() => heart(post, 'Unlike, 1 like'))).props['aria-pressed']).toBe(true);
    await waitFor(async () => expect(await serverSide(post)).toEqual({ liked: true, count: 1 }), { timeout: 3000 });
    expect(heart(post, 'Unlike, 1 like').props['aria-pressed']).toBe(true);
  });
});

describe('likes on several posts', () => {
  it('a failed like on one post still shows on it after another post was liked', async () => {
    const feed = await api.feed.getFeed({ limit: 20 });
    const friends = feed.items.filter((p) => p.actor.id !== userIdFor(ME.handle) && !p.likedByMe);
    expect(friends.length).toBeGreaterThanOrEqual(2);
    const [a, b] = friends as [FeedItem, FeedItem];
    await start();
    await screen.findByTestId(`feed-post-${a.id}`);
    const heartOf = (post: FeedItem, name: string) => within(screen.getByTestId(`feed-post-${post.id}`)).getByRole('button', { name });

    controls.setLatency(200);
    controls.failNext('network', 'feed.like');
    await fireEvent.press(heartOf(a, likeLabel(false, a.likeCount)));
    await fireEvent.press(heartOf(b, likeLabel(false, b.likeCount)));

    // A failed after B was tapped: A's heart goes back and A says why; B is liked and says nothing.
    const cardA = screen.getByTestId(`feed-post-${a.id}`);
    expect(
      await within(cardA).findByText("Couldn't like this post. Check your connection and try again.", {}, { timeout: 3000 }),
    ).toBeTruthy();
    await waitFor(async () => {
      const now = (await api.feed.getFeed({ limit: 20 })).items;
      expect(now.find((p) => p.id === b.id)?.likedByMe).toBe(true);
    }, { timeout: 3000 });
    expect(within(cardA).getByRole('button', { name: /^Like/ }).props['aria-pressed']).toBe(false);
    const cardB = screen.getByTestId(`feed-post-${b.id}`);
    await waitFor(() => expect(within(cardB).getByRole('button', { name: /^Unlike/ }).props['aria-pressed']).toBe(true));
    expect(within(cardB).queryByText(/Couldn't like this post/)).toBeNull();
    // Still there once B has settled.
    expect(within(cardA).getByText("Couldn't like this post. Check your connection and try again.")).toBeTruthy();
  });
});

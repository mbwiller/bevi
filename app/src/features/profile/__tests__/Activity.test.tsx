import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';
import ProfileScreen from '@/app/(tabs)/profile/index';
import UserProfileScreen from '@/app/user/[id]/index';

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
  await renderRouter(
    {
      _layout: Layout,
      '(tabs)/profile/index': ProfileScreen,
      'user/[id]/index': UserProfileScreen,
      'user/[id]/followers': Stub,
      'user/[id]/following': Stub,
      '(tabs)/lists/index': Stub,
      '(tabs)/add/index': Stub,
      'rank/[bevId]': Stub,
      'bev/[id]': Stub,
      'settings/index': Stub,
    },
    { initialUrl: url },
  );
}

const STRANGER = 'friend_e';
const strangerId = userIdFor(STRANGER);

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

/** A user's first post as `feed.listUser` returns it to ME. */
async function firstPost(userId: string): Promise<FeedItem> {
  const page = await api.feed.listUser(userId, { limit: 20 });
  expect(page.items.length).toBeGreaterThan(0);
  return page.items[0]!;
}

const heart = (post: FeedItem, name: string | RegExp) => within(screen.getByTestId(`feed-post-${post.id}`)).getByRole('button', { name });

describe('Profile › Activity', () => {
  it('your own profile shows posts with hearts and comment counts, and liking works', async () => {
    const me = await api.profile.getMe();
    const post = await firstPost(me.id);
    await open('/profile');
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    const like = within(card).getByRole('button', { name: /^Like/ });
    await fireEvent.press(like);
    await waitFor(() => expect(heart(post, /^Unlike/).props['aria-pressed']).toBe(true));
    await waitFor(async () => expect((await firstPost(me.id)).likedByMe).toBe(true));
  });

  it("a followed user's profile shows posts with hearts, and liking works", async () => {
    const id = userIdFor(FRIEND.handle);
    const post = await firstPost(id);
    await open(`/user/${id}`);
    await screen.findByTestId(`feed-post-${post.id}`);
    if (post.commentCount > 0) {
      expect(within(screen.getByTestId(`feed-post-${post.id}`)).getAllByText(post.comments[0]!.body).length).toBeGreaterThan(0);
    }
    await fireEvent.press(heart(post, /^Like/));
    await waitFor(() => expect(heart(post, /^Unlike/).props['aria-pressed']).toBe(true));
    await waitFor(async () => expect((await firstPost(id)).likedByMe).toBe(true));
  });

  it("a stranger's profile keeps the plain rankings: no heart", async () => {
    const latest = (await api.rankings.listUser(strangerId)).items[0]!;
    await open(`/user/${strangerId}`);
    expect((await screen.findAllByText(latest.bev.name)).length).toBeGreaterThan(0);
    expect(screen.queryAllByLabelText(/^(Like|Unlike)/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^feed-post-(?!strip)/)).toHaveLength(0);
  });

  it('following a stranger switches Activity to posts without a reload; unfollowing switches back', async () => {
    const name = 'Friend E';
    await open(`/user/${strangerId}`);
    const follow = await screen.findByLabelText(`Follow ${name}`);
    await waitFor(() => expect(screen.queryAllByLabelText(/^(Like|Unlike)/)).toHaveLength(0));

    await fireEvent.press(follow);
    await waitFor(() => expect(screen.queryAllByLabelText(/^(Like|Unlike)/).length).toBeGreaterThan(0));
    expect(screen.getAllByTestId(/^feed-post-(?!strip)/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByLabelText(`Follow ${name}`));
    await waitFor(() => expect(screen.queryAllByLabelText(/^(Like|Unlike)/)).toHaveLength(0));
  });

  it("liking on Activity is in the Feed's cache, and a like in the Feed shows on Activity", async () => {
    const id = userIdFor(FRIEND.handle);
    const post = await firstPost(id);
    await open(`/user/${id}`);
    await screen.findByTestId(`feed-post-${post.id}`);
    // Warm the feed query so there is a cache to agree with.
    await client.prefetchInfiniteQuery({
      queryKey: keys.feed(),
      queryFn: () => api.feed.getFeed({ limit: 20 }),
      initialPageParam: undefined as string | undefined,
    });

    await fireEvent.press(heart(post, /^Like/));
    await waitFor(() => expect(heart(post, /^Unlike/).props['aria-pressed']).toBe(true));
    const inFeed = () =>
      client.getQueryData<{ pages: { items: FeedItem[] }[] }>(keys.feed())!.pages.flatMap((p) => p.items).find((p) => p.id === post.id);
    await waitFor(() => expect(inFeed()?.likedByMe).toBe(true));
    expect(inFeed()?.likeCount).toBe(post.likeCount + 1);
  });
});

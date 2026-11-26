import type { FeedItem } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import PostRoute from '@/app/post/[id]';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';

import { POST_GONE_BODY, POST_GONE_TITLE } from '../PostScreen';

// The Post screen (T-31): one post, through the Feed's own rendering path, as a notification opens it.

// Each test mounts a route through renderRouter: slow on CI runners (see Comments.test.tsx).
jest.setTimeout(90_000);

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url: string) {
  const result = renderRouter(
    {
      _layout: Layout,
      'post/[id]': PostRoute,
      'feed/index': Stub,
      'bev/[id]': Stub,
      'rank/[bevId]': Stub,
      'user/[id]/index': Stub,
      'profile/index': Stub,
      index: Stub,
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
  controls.signInAs(ME.handle);
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

/** FRIEND's newest post, which ME follows and sees, and has not liked. */
async function friendsPost(): Promise<FeedItem> {
  const feed = await api.feed.getFeed({ limit: 20 });
  const post = feed.items.find((p) => p.actor.id === userIdFor(FRIEND.handle) && !p.likedByMe);
  expect(post).toBeDefined();
  return post!;
}

const card = (post: FeedItem) => screen.getByTestId(`feed-post-${post.id}`);

it("renders a followed friend's post as the feed does, under a Post header with Back", async () => {
  const post = await friendsPost();
  await start(`/post/${post.id}`);
  await screen.findByTestId(`feed-post-${post.id}`);
  expect(screen.getByRole('heading', { name: 'Post' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  expect(within(card(post)).getByText(post.bev.name)).toBeTruthy();
  // The feed's controls: the heart, the comment bubble, the More menu.
  expect(within(card(post)).getByRole('button', { name: /^Like/ })).toBeTruthy();
  expect(within(card(post)).getByRole('button', { name: /^Comment/ })).toBeTruthy();
  expect(within(card(post)).getByRole('button', { name: `More actions, post by @${post.actor.handle}` })).toBeTruthy();
  // No comments sheet unless asked for.
  expect(screen.queryByTestId('sheet')).toBeNull();
});

it('liking it updates the heart and the count on screen at once, and on the server', async () => {
  const post = await friendsPost();
  await start(`/post/${post.id}`);
  await screen.findByTestId(`feed-post-${post.id}`);
  controls.setLatency(800);
  await fireEvent.press(within(card(post)).getByRole('button', { name: /^Like/ }));
  // Optimistic: before the server answers.
  const n = post.likeCount + 1;
  expect(await within(card(post)).findByRole('button', { name: `Unlike, ${n} ${n === 1 ? 'like' : 'likes'}` })).toBeTruthy();
  expect(client.isMutating()).toBe(1);
  await waitFor(() => expect(client.isMutating()).toBe(0));
  controls.setLatency(0);
  expect((await api.feed.getPost(post.id)).likedByMe).toBe(true);
});

it('?comments=1 opens its comments once it has loaded, and not again after they are closed', async () => {
  const post = await friendsPost();
  controls.signInAs(FRIEND.handle);
  await api.comments.add(post.id, 'first!');
  controls.signInAs(ME.handle);
  await start(`/post/${post.id}?comments=1`);
  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText('first!')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('sheet-scrim'));
  await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
  // A later render (the post refetched) does not bring it back.
  await client.invalidateQueries({ queryKey: ['bevi', 'feed'] });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByTestId('sheet')).toBeNull();
  // The bubble still opens it.
  await fireEvent.press(within(card(post)).getByRole('button', { name: /^Comment/ }));
  expect(await screen.findByTestId('sheet')).toBeTruthy();
});

it('not_found: says the post is gone, and Back still works', async () => {
  await start('/post/no-such-post');
  expect(await screen.findByText(POST_GONE_TITLE)).toBeTruthy();
  expect(screen.getByText(POST_GONE_BODY)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('a post that goes while it is open (its comments answer not_found) shows the gone state', async () => {
  const post = await friendsPost();
  await start(`/post/${post.id}?comments=1`);
  const sheet = await screen.findByTestId('sheet');
  await within(sheet).findByText('No comments yet');
  // FRIEND's posts stop being visible: no longer followed.
  await api.follows.unfollow(userIdFor(FRIEND.handle));
  await fireEvent.changeText(within(sheet).getByLabelText('Add a comment'), 'anyone there?');
  await fireEvent.press(within(sheet).getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
  expect(await screen.findByText(POST_GONE_TITLE)).toBeTruthy();
  expect(screen.queryByTestId(`feed-post-${post.id}`)).toBeNull();
});

it('any other failure shows ErrorState, and Retry loads the post', async () => {
  const post = await friendsPost();
  controls.failNext('network', 'feed.getPost');
  await start(`/post/${post.id}`);
  await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByTestId(`feed-post-${post.id}`)).toBeTruthy();
});

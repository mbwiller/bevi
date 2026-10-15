import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';
import FeedScreen from '@/app/(tabs)/feed/index';

import { POST_GONE } from '../FeedScreen';

// Comments on feed posts (M-03), against the FakeApi through the real Feed route. Its own file
// rather than more of Feed.test.tsx: each renderRouter test holds a lot of memory until the file ends.

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

describe('comments', () => {
  /** FRIEND's newest post, which ME follows and sees. */
  async function friendsPost(): Promise<FeedItem> {
    const feed = await api.feed.getFeed({ limit: 20 });
    const post = feed.items.find((p) => p.actor.id === userIdFor(FRIEND.handle));
    expect(post).toBeDefined();
    return post!;
  }

  /** `n` comments by FRIEND on `post`, "friend comment 1" oldest. */
  async function seed(post: FeedItem, n: number, from = 1) {
    controls.signInAs(FRIEND.handle);
    for (let i = from; i < from + n; i++) await api.comments.add(post.id, `friend comment ${i}`);
    controls.signInAs(ME.handle);
  }

  const card = (post: FeedItem) => screen.getByTestId(`feed-post-${post.id}`);
  const sheet = () => screen.getByTestId('sheet');
  /** The sheet's comment bodies, top to bottom. */
  const threadBodies = () =>
    within(sheet())
      .queryAllByTestId(/^comment-row-/)
      .map((row) => String(within(row).getByTestId('comment-body').props.children));

  async function serverCount(post: FeedItem) {
    const feed = await api.feed.getFeed({ limit: 20 });
    return feed.items.find((p) => p.id === post.id)?.commentCount;
  }

  async function openFromBubble(post: FeedItem, name: string | RegExp = /^Comment/) {
    await start();
    const c = await screen.findByTestId(`feed-post-${post.id}`);
    await fireEvent.press(within(c).getByRole('button', { name }));
    return await screen.findByTestId('sheet');
  }

  it('opens from the comment bubble: the thread oldest first, Delete only on your own', async () => {
    const post = await friendsPost();
    await seed(post, 2);
    await api.comments.add(post.id, 'my comment');
    await openFromBubble(post, 'Comment, 3 comments');
    expect(within(sheet()).getByRole('header', { name: 'Comments' })).toBeTruthy();
    await waitFor(() => expect(threadBodies()).toEqual(['friend comment 1', 'friend comment 2', 'my comment']));
    expect(within(sheet()).getByRole('button', { name: 'Delete your comment: my comment' })).toBeTruthy();
    expect(within(sheet()).queryByRole('button', { name: /Delete your comment: friend/ })).toBeNull();
    // Inline on the post too, as "handle text".
    expect(within(card(post)).getByText(`${FRIEND.handle} friend comment 1`)).toBeTruthy();
  });

  it('above seven comments the post shows "View all N comments", which opens the whole thread', async () => {
    const post = await friendsPost();
    await seed(post, 8);
    await start();
    const c = await screen.findByTestId(`feed-post-${post.id}`);
    expect(within(c).queryByText(/friend comment/)).toBeNull();
    await fireEvent.press(within(c).getByRole('button', { name: 'View all 8 comments' }));
    await screen.findByTestId('sheet');
    await waitFor(() => expect(threadBodies()).toEqual(Array.from({ length: 8 }, (_, i) => `friend comment ${i + 1}`)));
  });

  it('empty: "No comments yet"', async () => {
    const post = await friendsPost();
    await openFromBubble(post, 'Comment');
    expect(await within(sheet()).findByText('No comments yet')).toBeTruthy();
    expect(within(sheet()).getByText('Start the conversation.')).toBeTruthy();
  });

  it('posts a comment: it lands in the sheet and on the post, the count goes up, the composer clears', async () => {
    const post = await friendsPost();
    await seed(post, 2);
    await openFromBubble(post, 'Comment, 2 comments');
    await waitFor(() => expect(threadBodies()).toHaveLength(2));
    const input = within(sheet()).getByLabelText('Add a comment');
    await fireEvent.changeText(input, '  Tastes like summer  ');
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(threadBodies()).toEqual(['friend comment 1', 'friend comment 2', 'Tastes like summer']));
    expect(within(sheet()).getByLabelText('Add a comment').props.value).toBe('');
    await waitFor(() => expect(within(card(post)).getByRole('button', { name: 'Comment, 3 comments' })).toBeTruthy());
    expect(within(card(post)).getByText(`${ME.handle} Tastes like summer`)).toBeTruthy();
    expect(await serverCount(post)).toBe(3);
  });

  it('a comment past the seventh adds to the count and collapses the post to "View all"', async () => {
    const post = await friendsPost();
    await seed(post, 7);
    await openFromBubble(post, 'Comment, 7 comments');
    await waitFor(() => expect(threadBodies()).toHaveLength(7));
    await fireEvent.changeText(within(sheet()).getByLabelText('Add a comment'), 'number eight');
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(within(card(post)).getByRole('button', { name: 'View all 8 comments' })).toBeTruthy());
    expect(within(card(post)).queryByText(/number eight/)).toBeNull();
  });

  it('Post is disabled while empty or over 280 characters; the count shows from 20 left', async () => {
    const post = await friendsPost();
    await openFromBubble(post);
    const postButton = () => within(sheet()).getByRole('button', { name: 'Post' });
    const input = () => within(sheet()).getByLabelText('Add a comment');
    expect(postButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(input(), '   ');
    expect(postButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(input(), 'x'.repeat(259));
    expect(within(sheet()).queryByLabelText('21 characters left')).toBeNull();
    await fireEvent.changeText(input(), 'x'.repeat(260));
    expect(within(sheet()).getByLabelText('20 characters left')).toBeTruthy();
    expect(postButton().props.accessibilityState.disabled).toBe(false);
    await fireEvent.changeText(input(), 'x'.repeat(281));
    expect(within(sheet()).getByLabelText('1 character over')).toBeTruthy();
    expect(postButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(postButton());
    expect(await serverCount(post)).toBe(0);
  });

  it('deletes your own comment after confirming in the sheet; the count goes down', async () => {
    const post = await friendsPost();
    await seed(post, 1);
    await api.comments.add(post.id, 'my comment');
    await openFromBubble(post, 'Comment, 2 comments');
    await waitFor(() => expect(threadBodies()).toEqual(['friend comment 1', 'my comment']));

    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Delete your comment: my comment' }));
    // It asks first, in the row; Cancel keeps it.
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Cancel, keep comment' }));
    expect(threadBodies()).toEqual(['friend comment 1', 'my comment']);
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Delete your comment: my comment' }));
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Delete comment' }));

    await waitFor(() => expect(threadBodies()).toEqual(['friend comment 1']));
    await waitFor(() => expect(within(card(post)).getByRole('button', { name: 'Comment, 1 comment' })).toBeTruthy());
    expect(within(card(post)).queryByText(/my comment/)).toBeNull();
    expect(await serverCount(post)).toBe(1);
  });

  it.each([
    ['rate_limited', "Couldn't post your comment. Wait a minute, then try again."],
    ['network', "Couldn't post your comment. Check your connection and try again."],
  ] as const)('%s keeps the text and says why under the composer', async (code, message) => {
    const post = await friendsPost();
    await openFromBubble(post);
    await within(sheet()).findByText('No comments yet');
    await fireEvent.changeText(within(sheet()).getByLabelText('Add a comment'), 'hold on to this');
    controls.failNext(code, 'comments.add');
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Post' }));
    expect(await within(sheet()).findByText(message)).toBeTruthy();
    expect(within(sheet()).getByLabelText('Add a comment').props.value).toBe('hold on to this');
    expect(within(card(post)).getByRole('button', { name: 'Comment' })).toBeTruthy();
    // Posting again goes through and clears the error.
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(threadBodies()).toEqual(['hold on to this']));
    expect(within(sheet()).queryByText(message)).toBeNull();
  });

  it("not_found: the post is gone, so the sheet closes, the feed says so and refetches", async () => {
    const post = await friendsPost();
    await openFromBubble(post);
    await within(sheet()).findByText('No comments yet');
    // FRIEND's posts stop being visible: no longer followed.
    await api.follows.unfollow(userIdFor(FRIEND.handle));
    await fireEvent.changeText(within(sheet()).getByLabelText('Add a comment'), 'anyone there?');
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Post' }));

    expect(await screen.findByText(POST_GONE)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId(`feed-post-${post.id}`)).toBeNull());
  });

  it('more than a page: the newest 20 first, "Load earlier comments" brings the older ones above', async () => {
    const post = await friendsPost();
    await seed(post, 25);
    await openFromBubble(post, 'Comment, 25 comments');
    const all = Array.from({ length: 25 }, (_, i) => `friend comment ${i + 1}`);
    await waitFor(() => expect(threadBodies()).toEqual(all.slice(5)));
    await fireEvent.press(within(sheet()).getByRole('button', { name: 'Load earlier comments' }));
    await waitFor(() => expect(threadBodies()).toEqual(all));
    expect(within(sheet()).queryByRole('button', { name: 'Load earlier comments' })).toBeNull();
  });
});

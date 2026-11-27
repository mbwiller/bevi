import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { ExplorePost, FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import FeedScreen from '@/app/(tabs)/feed/index';
import { ME, controls, userIdFor } from '@/testing/fakeApi';

// The More menu on a post (Your feed and Explore) and on a comment, through the real Feed route:
// where it shows, where it does not, and that blocking takes the person out of what is on screen.
// A test waits on the thing it asserts (waitFor / findBy), never on a count of ticks.

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

async function start(url = '/feed') {
  await renderRouter(
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
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: null, week: null });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

/** The newest post in Your feed that is not ME's. */
async function othersPost(): Promise<FeedItem> {
  const me = await api.profile.getMe();
  const post = (await api.feed.getFeed({ limit: 20 })).items.find((p) => p.actor.id !== me.id);
  expect(post).toBeDefined();
  return post!;
}

const moreOn = (post: { actor: { handle: string } }) => `More actions, post by @${post.actor.handle}`;
/** The sheet on top (a later Modal sits above an earlier one). */
const topSheet = () => within(screen.getAllByTestId('sheet').at(-1)!);

describe('Your feed', () => {
  it("has More on someone else's post, and Delete post (never report or block) on your own", async () => {
    const post = await othersPost();
    await start();
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    const more = within(card).getByRole('button', { name: moreOn(post) });
    expect(more).toBeTruthy();
    // ME's own post is in the same list, drawn, with no More.
    const me = await api.profile.getMe();
    const own = (await api.feed.getFeed({ limit: 20 })).items.find((p) => p.actor.id === me.id)!;
    const ownCard = await screen.findByTestId(`feed-post-${own.id}`);
    expect(within(ownCard).getByText('You')).toBeTruthy();
    expect(within(ownCard).queryByRole('button', { name: /^More actions, post by/ })).toBeNull();
    await fireEvent.press(within(ownCard).getByRole('button', { name: 'More actions, your post' }));
    expect(await topSheet().findByRole('button', { name: 'Delete post' })).toBeTruthy();
    expect(topSheet().queryByRole('button', { name: 'Report post' })).toBeNull();
    expect(topSheet().queryByRole('button', { name: /^Block/ })).toBeNull();
  });

  it('deleting your own post takes it out of the feed (TICKET-32)', async () => {
    const me = await api.profile.getMe();
    const own = (await api.feed.getFeed({ limit: 20 })).items.find((p) => p.actor.id === me.id)!;
    await start();
    const ownCard = await screen.findByTestId(`feed-post-${own.id}`);
    await fireEvent.press(within(ownCard).getByRole('button', { name: 'More actions, your post' }));
    await fireEvent.press(await topSheet().findByRole('button', { name: 'Delete post' }));
    await fireEvent.press(topSheet().getByRole('button', { name: `Delete ${own.bev.name}` }));
    await waitFor(() => expect(screen.queryByTestId(`feed-post-${own.id}`)).toBeNull());
    expect((await api.rankings.listMine()).items.some((r) => r.bevId === own.bev.id)).toBe(false);
  });

  it('Report post files the report for that post and hides nothing', async () => {
    const post = await othersPost();
    const spy = jest.spyOn(api.reports, 'report');
    await start();
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    await fireEvent.press(within(card).getByRole('button', { name: moreOn(post) }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Report post' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thanks, we got your report')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ kind: 'post', id: post.id, reason: 'spam', note: undefined });
    expect(screen.getByTestId(`feed-post-${post.id}`)).toBeTruthy();
  });

  it('Block account takes every post by that person out of the feed', async () => {
    const post = await othersPost();
    await start();
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    await fireEvent.press(within(card).getByRole('button', { name: moreOn(post) }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${post.actor.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${post.actor.handle}` }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: new RegExp(`post by @${post.actor.handle}$`) })).toHaveLength(0));
    expect(screen.queryByTestId(`feed-post-${post.id}`)).toBeNull();
    // The server agrees: they are in Blocked accounts and gone from the feed.
    expect((await api.blocks.list()).items.map((b) => b.id)).toEqual([post.actor.id]);
    expect((await api.feed.getFeed({ limit: 20 })).items.some((p) => p.actor.id === post.actor.id)).toBe(false);
  });
});

describe('Explore', () => {
  it('has More on every post, and Block account takes the author out', async () => {
    const posts: ExplorePost[] = (await api.feed.getExplore({ limit: 20 })).items;
    const first = posts[0]!;
    await start('/feed?segment=explore');
    const card = await screen.findByTestId(`explore-post-${first.id}`);
    await fireEvent.press(within(card).getByRole('button', { name: moreOn(first) }));
    expect(await screen.findByRole('button', { name: 'Report post' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `Block @${first.actor.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${first.actor.handle}` }));
    await waitFor(() => expect(screen.queryByTestId(`explore-post-${first.id}`)).toBeNull());
    expect(screen.queryAllByRole('button', { name: new RegExp(`post by @${first.actor.handle}$`) })).toHaveLength(0);
  });
});

describe('comments', () => {
  /** A post by one person with a comment by another (so blocking the commenter leaves the post), and one of ME's. */
  async function postWithComments() {
    const me = await api.profile.getMe();
    const feed = (await api.feed.getFeed({ limit: 20 })).items;
    const post = feed.find((p) => p.actor.id !== me.id)!;
    const commenter = feed.find((p) => p.actor.id !== me.id && p.actor.id !== post.actor.id)!.actor;
    await api.comments.add(post.id, 'my own comment');
    controls.signInAs(commenter.handle);
    await api.comments.add(post.id, 'their comment');
    controls.signInAs(ME.handle);
    return { post, commenter };
  }

  async function openThread(post: FeedItem) {
    await start();
    const card = await screen.findByTestId(`feed-post-${post.id}`);
    await fireEvent.press(within(card).getByRole('button', { name: /^Comment/ }));
    await waitFor(() => expect(screen.getAllByTestId(/^comment-row-/)).toHaveLength(2));
  }

  it("has More on someone else's comment, not on your own", async () => {
    const { post, commenter } = await postWithComments();
    await openThread(post);
    const sheet = topSheet();
    expect(sheet.getByRole('button', { name: `More actions, comment by @${commenter.handle}` })).toBeTruthy();
    expect(sheet.queryByRole('button', { name: `More actions, comment by @${ME.handle}` })).toBeNull();
    expect(sheet.getByRole('button', { name: 'Delete your comment: my own comment' })).toBeTruthy();
  });

  it("presents the More menu from inside the comments sheet's Modal, not beside it", async () => {
    // On iOS a Modal presents from the nearest view controller. Beside the comments sheet, the More
    // menu would present from the controller already presenting it and UIKit would refuse (nothing
    // shows, and every later tap is dead). Nested inside, it presents from the comments sheet's own.
    // Jest renders Modals inline, so only the tree shows it; a device proves the presentation.
    const { post, commenter } = await postWithComments();
    await openThread(post);
    await fireEvent.press(topSheet().getByRole('button', { name: `More actions, comment by @${commenter.handle}` }));
    const report = await screen.findByRole('button', { name: 'Report comment' });
    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames).toHaveLength(2);
    const [comments, safety] = frames;
    expect(within(comments!).getByRole('button', { name: 'Report comment' })).toBe(report);
    expect(within(safety!).getByRole('button', { name: 'Report comment' })).toBe(report);
    expect(within(comments!).getByTestId('comment-composer')).toBeTruthy();
    expect(within(safety!).queryByTestId('comment-composer')).toBeNull();
  });

  it('Report comment reports that comment', async () => {
    const { post, commenter } = await postWithComments();
    const thread = await api.comments.list(post.id, { limit: 20 });
    const theirs = thread.items.find((c) => c.author.id === commenter.id)!;
    const spy = jest.spyOn(api.reports, 'report');
    await openThread(post);
    await fireEvent.press(topSheet().getByRole('button', { name: `More actions, comment by @${commenter.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Report comment' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Harassment or bullying' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thanks, we got your report')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ kind: 'comment', id: theirs.id, reason: 'harassment', note: undefined });
  });

  it('Block account from a comment takes their comment out of the thread, and leaves the rest', async () => {
    const { post, commenter } = await postWithComments();
    await openThread(post);
    await fireEvent.press(topSheet().getByRole('button', { name: `More actions, comment by @${commenter.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${commenter.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${commenter.handle}` }));
    await waitFor(() => expect(screen.queryByText('their comment')).toBeNull());
    expect(screen.getByText('my own comment')).toBeTruthy();
    expect(screen.getByTestId(`feed-post-${post.id}`)).toBeTruthy();
  });
});

it('the blocked person is a real server-side block (sanity for the fixtures above)', async () => {
  const post = await othersPost();
  await api.blocks.block(post.actor.id);
  await expect(api.profile.getUser(post.actor.id)).rejects.toMatchObject({ code: 'not_found' });
  expect(userIdFor(post.actor.handle)).toBe(post.actor.id);
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { act, fireEvent, renderHook, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import type { ExplorePost, FeedItem, Page } from '@bevi/shared';

import { api } from '@/api/client';
import { restartExplore, useExplore } from '@/api/hooks';
import { keys } from '@/api/keys';
import { commentLabel } from '@/components/CommentButton';
import { categoryById } from '@/lib/categories';
import { ALCOHOLIC_BEV_ID, ME, MINOR, controls } from '@/testing/fakeApi';
import FeedScreen from '@/app/(tabs)/feed/index';
import { EXPLORE_EMPTY_BODY, EXPLORE_EMPTY_TITLE } from '@/features/feed/FeedScreen';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url = '/feed?segment=explore') {
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
  controls.signInAs(ME.handle);
  // As in Feed.test.tsx: the Bev of the day and week has its own suite.
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: null, week: null });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

/** Explore's first page as the server has it now. */
async function firstPage(): Promise<ExplorePost[]> {
  const page = await api.feed.getExplore({ limit: 20 });
  expect(page.items.length).toBeGreaterThan(0);
  return page.items;
}

/** The list's ScrollView. FlashList hands it the refresh control. */
const list = () => screen.getByTestId('feed-list');
const pullToRefresh = () => act(() => list().props.refreshControl.props.onRefresh());
/** Under jest FlashList reaches its end on its own, so every page loads; wait for that to settle. */
const settled = () => waitFor(() => expect(client.isFetching()).toBe(0));
const postCard = (p: ExplorePost) => screen.getByTestId(`explore-post-${p.id}`);
const explorePages = () => client.getQueryData<{ pages: Page<ExplorePost>[] }>(keys.explore())?.pages ?? [];

describe('segments', () => {
  it('Your feed is the default; Explore is a tab that keeps itself in the URL', async () => {
    const getExplore = jest.spyOn(api.feed, 'getExplore');
    const [top] = await firstPage();
    getExplore.mockClear();
    const r = await start('/feed');

    expect(await screen.findByRole('tab', { name: 'Your feed', selected: true })).toBeTruthy();
    // Your feed's posts carry hearts; Explore isn't fetched until it's opened.
    expect((await screen.findAllByRole('button', { name: /^(Like|Unlike)/ })).length).toBeGreaterThan(0);
    expect(getExplore).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('tab', { name: 'Explore' }));
    expect(r.path()).toBe('/feed?segment=explore');
    expect(await screen.findByTestId(`explore-post-${top!.id}`)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Explore', selected: true })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^(Like|Unlike)/ })).toHaveLength(0);
    expect(getExplore).toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('tab', { name: 'Your feed' }));
    expect(r.path()).toBe('/feed?segment=feed');
    expect((await screen.findAllByRole('button', { name: /^(Like|Unlike)/ })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId(`explore-post-${top!.id}`)).toBeNull();
  });

  it('?segment=explore opens on Explore', async () => {
    const [top] = await firstPage();
    await start();
    expect(await screen.findByTestId(`explore-post-${top!.id}`)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Explore', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Your feed', selected: false })).toBeTruthy();
  });
});

describe('posts', () => {
  it('are plain and read-only: no heart, counts, comments, Rank it or Want to Try; the author has a Follow pill', async () => {
    const like = jest.spyOn(api.feed, 'like');
    const addComment = jest.spyOn(api.comments, 'add');
    const [top] = await firstPage();
    await start();
    const card = await screen.findByTestId(`explore-post-${top!.id}`);

    expect(within(card).getAllByText(top!.bev.name).length).toBeGreaterThan(0);
    expect(within(card).queryByRole('button', { name: /^(Like|Unlike)/ })).toBeNull();
    expect(within(card).queryByLabelText(commentLabel(0))).toBeNull();
    expect(within(card).queryByLabelText(/comment/i)).toBeNull();
    expect(within(card).queryByLabelText(`Rank ${top!.bev.name}`)).toBeNull();
    expect(within(card).queryByLabelText(/to Want to Try$/)).toBeNull();
    expect(within(card).queryByTestId('feed-post-comments')).toBeNull();
    const follow = within(card).getByRole('button', { name: `Follow ${top!.actor.displayName}` });
    expect(follow.props['aria-pressed']).toBe(false);

    // A double-tap likes nothing.
    const when = within(card).getAllByText(/ago|day/)[0]!;
    await fireEvent.press(when);
    await fireEvent.press(when);
    expect(screen.queryByTestId('like-burst')).toBeNull();
    expect(like).not.toHaveBeenCalled();
    expect(addComment).not.toHaveBeenCalled();
  });

  it('tapping the photo opens the Bev', async () => {
    const [top] = await firstPage();
    const r = await start();
    const card = await screen.findByTestId(`explore-post-${top!.id}`);
    await fireEvent.press(within(card).getByLabelText(`Open ${top!.bev.name}`));
    expect(r.path()).toBe(`/bev/${top!.bev.id}`);
  });

  it("tapping the avatar opens the author's profile", async () => {
    const [top] = await firstPage();
    const r = await start();
    const card = await screen.findByTestId(`explore-post-${top!.id}`);
    await fireEvent.press(within(card).getByLabelText(`${top!.actor.displayName}, @${top!.actor.handle}`));
    expect(r.path()).toBe(`/user/${top!.actor.id}`);
  });
});

describe('paging', () => {
  it("fetches the next page by the last page's cursor", async () => {
    const page1 = await api.feed.getExplore({ limit: 20 });
    expect(page1.nextCursor).toBeTruthy();
    const getExplore = jest.spyOn(api.feed, 'getExplore');
    await start();
    await screen.findByTestId(`explore-post-${page1.items[0]!.id}`);
    await waitFor(() => expect(getExplore.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(getExplore.mock.calls[0]).toEqual([{ cursor: undefined, limit: 20 }]);
    expect(getExplore.mock.calls[1]).toEqual([{ cursor: page1.nextCursor, limit: 20 }]);
    await settled();
    expect(explorePages().length).toBeGreaterThanOrEqual(2);
  });

  it('pull to refresh starts a fresh sequence, with no cursor', async () => {
    const [top] = await firstPage();
    const getExplore = jest.spyOn(api.feed, 'getExplore');
    await start();
    await screen.findByTestId(`explore-post-${top!.id}`);
    await settled();
    expect(explorePages().length).toBeGreaterThanOrEqual(2);
    getExplore.mockClear();

    await pullToRefresh();
    await waitFor(() => expect(getExplore).toHaveBeenCalled());
    // The first call of the new sequence has no cursor; no page of the old one is asked for again.
    expect(getExplore.mock.calls[0]).toEqual([{ cursor: undefined, limit: 20 }]);
    await settled();
    expect(client.getQueryData<{ pageParams: unknown[] }>(keys.explore())?.pageParams[0]).toBeUndefined();
  });

  it('restartExplore keeps only the first page and refetches it with no cursor', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const explore = await renderHook(() => useExplore(), { wrapper });
    await waitFor(() => expect(explore.result.current.isSuccess).toBe(true));
    await act(() => explore.result.current.fetchNextPage());
    await act(() => explore.result.current.fetchNextPage());
    expect(explorePages()).toHaveLength(3);
    const getExplore = jest.spyOn(api.feed, 'getExplore');

    await act(() => restartExplore(client));
    expect(getExplore).toHaveBeenCalledTimes(1);
    expect(getExplore).toHaveBeenCalledWith({ cursor: undefined, limit: 20 });
    expect(explorePages()).toHaveLength(1);
    expect(explore.result.current.hasNextPage).toBe(true);
  });
});

describe('states', () => {
  it('shows skeletons while loading', async () => {
    controls.setLatency(500);
    await start();
    expect(await screen.findByTestId('feed-skeleton')).toBeTruthy();
  });

  it('nothing popular yet: the empty state', async () => {
    jest.spyOn(api.feed, 'getExplore').mockResolvedValue({ items: [], nextCursor: null });
    await start();
    expect(await screen.findByText(EXPLORE_EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(EXPLORE_EMPTY_BODY)).toBeTruthy();
    // Explore's empty state, not Your feed's.
    expect(screen.queryByText('Follow friends to see their Bevs')).toBeNull();
  });

  it('offline: ErrorState, and Retry loads the posts', async () => {
    const [top] = await firstPage();
    controls.failNext('network', 'feed.getExplore');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByTestId(`explore-post-${top!.id}`)).toBeTruthy();
    expect(screen.queryByLabelText('Retry')).toBeNull();
  });

  it('signed out: ErrorState without Retry', async () => {
    controls.failNext('unauthorized', 'feed.getExplore');
    await start();
    expect(await screen.findByText("You're signed out")).toBeTruthy();
    expect(screen.queryByLabelText('Retry')).toBeNull();
  });
});

describe('follow', () => {
  it('follows the author: the pill turns to Following in place, and after a refresh their posts are in Your feed, not Explore', async () => {
    const follow = jest.spyOn(api.follows, 'follow');
    const [top] = await firstPage();
    const author = top!.actor;
    await start();
    const card = await screen.findByTestId(`explore-post-${top!.id}`);

    await fireEvent.press(within(card).getByRole('button', { name: `Follow ${author.displayName}` }));
    expect(follow).toHaveBeenCalledWith(author.id);
    await waitFor(() =>
      expect(within(postCard(top!)).getByRole('button', { name: `Follow ${author.displayName}` }).props['aria-pressed']).toBe(true),
    );
    expect(within(postCard(top!)).getByText('Following')).toBeTruthy();
    // The followed author's posts stay put until Explore starts over.
    await waitFor(() => expect(client.getQueryState(keys.explore())?.isInvalidated).toBe(true));
    expect(postCard(top!)).toBeTruthy();

    // Your feed was invalidated, and has them now.
    await waitFor(() =>
      expect(
        client.getQueryData<{ pages: Page<FeedItem>[] }>(keys.feed())?.pages.some((p) => p.items.some((i) => i.actor.id === author.id)),
      ).toBe(true),
    );

    await pullToRefresh();
    await waitFor(() => expect(screen.queryByTestId(`explore-post-${top!.id}`)).toBeNull());
    await settled();
    expect(explorePages().flatMap((p) => p.items).some((p) => p.actor.id === author.id)).toBe(false);
    expect(screen.queryAllByRole('button', { name: `Follow ${author.displayName}` })).toHaveLength(0);
  });

  it('a failed follow goes back to Follow', async () => {
    const [top] = await firstPage();
    const author = top!.actor;
    await start();
    const card = await screen.findByTestId(`explore-post-${top!.id}`);
    controls.setLatency(200);
    controls.failNext('network', 'follows.follow');
    await fireEvent.press(within(card).getByRole('button', { name: `Follow ${author.displayName}` }));
    const pill = () => within(postCard(top!)).getByRole('button', { name: `Follow ${author.displayName}` });
    await waitFor(() => expect(pill().props['aria-pressed']).toBe(true), { timeout: 150 });
    await waitFor(() => expect(pill().props['aria-pressed']).toBe(false), { timeout: 3000 });
    expect(within(postCard(top!)).getByText('Follow')).toBeTruthy();
  });

  it('Following again unfollows', async () => {
    const unfollow = jest.spyOn(api.follows, 'unfollow');
    const [top] = await firstPage();
    const author = top!.actor;
    await start();
    await screen.findByTestId(`explore-post-${top!.id}`);
    const pill = () => within(postCard(top!)).getByRole('button', { name: `Follow ${author.displayName}` });
    await fireEvent.press(pill());
    await waitFor(() => expect(pill().props['aria-pressed']).toBe(true));
    await fireEvent.press(pill());
    expect(unfollow).toHaveBeenCalledWith(author.id);
    await waitFor(() => expect(pill().props['aria-pressed']).toBe(false));
  });
});

describe('under 21', () => {
  it('a minor sees no alcoholic posts', async () => {
    controls.signInAs(MINOR.handle);
    const items = await firstPage();
    await start();
    await screen.findByTestId(`explore-post-${items[0]!.id}`);
    for (const p of items) expect(categoryById(p.bev.categoryId)?.isAlcoholic).toBeFalsy();
    expect(screen.queryAllByTestId(/^explore-post-/).length).toBeGreaterThan(0);
  });

  it('hides an alcoholic post from a minor even if the server sent one', async () => {
    controls.signInAs(MINOR.handle);
    const items = await firstPage();
    const leaked: ExplorePost = { ...items[0]!, id: 'leaked-beer', bev: { ...items[0]!.bev, id: ALCOHOLIC_BEV_ID, name: 'Leaked beer', categoryId: 'beer' } };
    jest.spyOn(api.feed, 'getExplore').mockResolvedValue({ items: [leaked, ...items.slice(1)], nextCursor: null });
    await start();
    await screen.findByTestId(`explore-post-${items[1]!.id}`);
    expect(screen.queryByTestId('explore-post-leaked-beer')).toBeNull();
    expect(screen.queryByText('Leaked beer')).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import { categoryById } from '@/lib/categories';
import { FRIEND, ME, MINOR, controls, userIdFor } from '@/testing/fakeApi';
import FeedScreen from '@/app/(tabs)/feed/index';
import UserProfileScreen from '@/app/user/[id]/index';

// "Bev'd it too" on a feed post (TASKS.md M-34, contract 2.12.0 `FeedItem.alsoBevdBy`): the Feed and
// a person's Activity pass the post's friends to FeedPost, which writes the line. Driven through the
// FakeApi: the friends rank the Bevs, then the post's author does, so each author's post is the one
// with the friends before it. Its own file, as Comments.test.tsx is.

// Each test here mounts the whole Feed route (renderRouter). That is 2 to 4 seconds on a laptop and
// several times that on GitHub's runners, where the slowest tests ran past the 30s default from
// jest.config.js on three CI runs on 2026-11-11. They are slow there, not stuck: the same commit
// passes on a rerun.
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
  const result = renderRouter(
    {
      _layout: Layout,
      'feed/index': FeedScreen,
      'user/[id]/index': UserProfileScreen,
      'user/[id]/followers': Stub,
      'user/[id]/following': Stub,
      'bev/[id]': Stub,
      'rank/[bevId]': Stub,
      'profile/index': Stub,
      'add/index': Stub,
      'lists/index': Stub,
      'settings/index': Stub,
      people: Stub,
    },
    { initialUrl: url },
  );
  await result;
}

/** Distinct first names, since FeedPost names people by first name and every fixture friend is "Friend …". */
const NAMES: Record<string, string> = { friend_b: 'Bea Two', friend_c: 'Cal Three', friend_d: 'Dee Four', friend_e: 'Eli Five' };

const AUTHOR = FRIEND.handle;
const EVERYONE = [ME.handle, FRIEND.handle, 'friend_b', 'friend_c', 'friend_d', 'friend_e', MINOR.handle];

/** Who ranks each scenario's Bev before AUTHOR does, oldest first. */
const SCENARIOS = {
  nobody: [],
  one: ['friend_b'],
  two: ['friend_b', 'friend_c'],
  three: ['friend_b', 'friend_c', 'friend_d'],
  four: ['friend_b', 'friend_c', 'friend_d', 'friend_e'],
} as const;
type Scenario = keyof typeof SCENARIOS;

async function rankAs(handle: string, bevId: string) {
  controls.signInAs(handle);
  const ids = await api.rankings.listBucket('LOVED');
  await api.rankings.submitRanking({
    bevId,
    bucket: 'LOVED',
    insertIndex: ids.length,
    expectedBucketSize: ids.length,
    comparisons: ids.length ? [{ winnerBevId: ids[ids.length - 1]!, loserBevId: bevId, tie: false }] : [],
  });
}

/** Non-alcoholic Bevs nobody in the fixtures has ranked. */
async function freshBevs(n: number): Promise<string[]> {
  const ranked = new Set<string>();
  for (const handle of EVERYONE) {
    controls.signInAs(handle);
    let cursor: string | undefined;
    do {
      const page = await api.rankings.listMine({ page: { cursor, limit: 100 } });
      for (const r of page.items) ranked.add(r.bev.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  controls.signInAs(ME.handle);
  const starters = await api.bevs.getStarterCandidates();
  const out = starters.filter((b) => !ranked.has(b.id) && !categoryById(b.categoryId)?.isAlcoholic).map((b) => b.id);
  expect(out.length).toBeGreaterThanOrEqual(n);
  return out.slice(0, n);
}

/** The scenarios' Bevs, ranked as described, and AUTHOR's post on each, as ME's feed has it. */
async function seed(): Promise<Record<Scenario, FeedItem>> {
  for (const [handle, name] of Object.entries(NAMES)) {
    controls.signInAs(handle);
    await api.profile.updateMe({ displayName: name });
  }
  controls.signInAs(ME.handle);
  // ME follows friend_a to friend_d already; friend_e too, so four other friends can rank one Bev.
  await api.follows.follow(userIdFor('friend_e'));

  const scenarios = Object.keys(SCENARIOS) as Scenario[];
  const bevs = await freshBevs(scenarios.length);
  const bevOf = {} as Record<Scenario, string>;
  for (const [i, s] of scenarios.entries()) {
    bevOf[s] = bevs[i]!;
    for (const handle of SCENARIOS[s]) await rankAs(handle, bevOf[s]);
    await rankAs(AUTHOR, bevOf[s]);
  }

  controls.signInAs(ME.handle);
  const feed = await api.feed.getFeed({ limit: 50 });
  const posts = {} as Record<Scenario, FeedItem>;
  for (const s of scenarios) {
    posts[s] = feed.items.find((p) => p.actor.id === userIdFor(AUTHOR) && p.bev.id === bevOf[s])!;
    expect(posts[s]).toBeDefined();
  }
  return posts;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  // Not about the Bev of the day and week (BevOfPeriod.test.tsx), as in Feed.test.tsx.
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: null, week: null });
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

const card = (post: FeedItem) => screen.getByTestId(`feed-post-${post.id}`);
const alsoLine = (post: FeedItem) => within(card(post)).queryByTestId('post-also');

/** The line FeedPost writes for each scenario: the two most recent rankers by first name, then the rest. */
const LINES: Record<Exclude<Scenario, 'nobody'>, string> = {
  one: "Bea Bev'd it too",
  two: "Cal and Bea Bev'd it too",
  three: "Dee, Cal and 1 other Bev'd it too",
  four: "Eli, Dee and 2 others Bev'd it too",
};

describe("Bev'd it too on the Feed", () => {
  it('the contract gives each post the friends before its author, newest first, three at most', async () => {
    const posts = await seed();
    const handles = (p: FeedItem) => p.alsoBevdBy.map((f) => f.profile.handle);
    expect([posts.nobody.alsoBevdCount, handles(posts.nobody)]).toEqual([0, []]);
    expect([posts.one.alsoBevdCount, handles(posts.one)]).toEqual([1, ['friend_b']]);
    expect([posts.two.alsoBevdCount, handles(posts.two)]).toEqual([2, ['friend_c', 'friend_b']]);
    expect([posts.three.alsoBevdCount, handles(posts.three)]).toEqual([3, ['friend_d', 'friend_c', 'friend_b']]);
    expect([posts.four.alsoBevdCount, handles(posts.four)]).toEqual([4, ['friend_e', 'friend_d', 'friend_c']]);
  });

  it('writes the line for one, two, three and more than three friends, and nothing for nobody', async () => {
    const posts = await seed();
    await start();
    await screen.findByTestId(`feed-post-${posts.four.id}`);
    for (const s of ['one', 'two', 'three', 'four'] as const) {
      await waitFor(() => expect(within(card(posts[s])).getByText(LINES[s])).toBeTruthy());
    }
    expect(alsoLine(posts.nobody)).toBeNull();
    expect(within(card(posts.nobody)).queryByText(/Bev'd it too/)).toBeNull();
  });

  it('a like on the post keeps the line', async () => {
    const posts = await seed();
    await start();
    const post = posts.four;
    await screen.findByTestId(`feed-post-${post.id}`);
    expect(within(card(post)).getByText(LINES.four)).toBeTruthy();
    controls.setLatency(200);
    await fireEvent.press(within(card(post)).getByRole('button', { name: /^Like/ }));
    // Optimistic, then confirmed: the line stays through both.
    await waitFor(() => expect(within(card(post)).getByRole('button', { name: /^Unlike/ })).toBeTruthy());
    expect(within(card(post)).getByText(LINES.four)).toBeTruthy();
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(within(card(post)).getByText(LINES.four)).toBeTruthy();
  });

  it('a comment on the post keeps the line', async () => {
    const posts = await seed();
    await start();
    const post = posts.two;
    await screen.findByTestId(`feed-post-${post.id}`);
    await fireEvent.press(within(card(post)).getByRole('button', { name: /^Comment/ }));
    const sheet = await screen.findByTestId('sheet');
    await fireEvent.changeText(within(sheet).getByLabelText('Add a comment'), 'Same here');
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(within(card(post)).getByText(`${ME.handle} Same here`)).toBeTruthy());
    expect(within(card(post)).getByText(LINES.two)).toBeTruthy();
  });
});

describe('a post in an older shape', () => {
  it('draws without alsoBevdBy or alsoBevdCount, with no line, and the Feed stays up', async () => {
    const getFeed = api.feed.getFeed.bind(api.feed);
    // As a mock, a fixture or a post cached before contract 2.12.0 would have it.
    jest.spyOn(api.feed, 'getFeed').mockImplementation(async (page) => {
      const res = await getFeed(page);
      return { ...res, items: res.items.map(({ alsoBevdBy: _a, alsoBevdCount: _c, ...old }) => old as FeedItem) };
    });
    const posts = (await getFeed({ limit: 20 })).items;
    const withFriends = posts.find((p) => p.alsoBevdCount > 0)!;
    expect(withFriends).toBeDefined();
    await start();
    await screen.findByTestId(`feed-post-${withFriends.id}`);
    expect(alsoLine(withFriends)).toBeNull();
    expect(screen.queryByText(/Bev'd it too/)).toBeNull();
    expect(screen.getByText('Your feed')).toBeTruthy();
  });
});

describe("Bev'd it too on a person's Activity", () => {
  it("passes the same line on the author's profile, relative to you", async () => {
    const posts = await seed();
    await start(`/user/${userIdFor(AUTHOR)}`);
    await screen.findByTestId(`feed-post-${posts.four.id}`);
    for (const s of ['one', 'two', 'three', 'four'] as const) {
      await waitFor(() => expect(within(card(posts[s])).getByText(LINES[s])).toBeTruthy());
    }
    expect(alsoLine(posts.nobody)).toBeNull();
  });
});

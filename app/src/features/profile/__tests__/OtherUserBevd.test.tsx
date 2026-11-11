import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { render } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { api } from '@/api/client';
import UserProfileScreen from '@/app/user/[id]/index';
import { ProfileHero } from '@/features/profile/ProfileParts';
import { controls } from '@/testing/fakeApi';

const mockScrollToIndex = jest.fn();

// A stand-in list: it renders the screen's header and hands the screen a ref it can scroll, so the
// test sees exactly what the Bev'd count asks the Activity list to do.
jest.mock('@/features/profile/ActivityList', () => {
  const actual = jest.requireActual('@/features/profile/ActivityList');
  const { View } = require('react-native');
  return {
    ...actual,
    ActivityList: ({ header, listRef }: { header: unknown; listRef?: { current: unknown } }) => {
      if (listRef) listRef.current = { scrollToIndex: mockScrollToIndex };
      return <View testID="activity-list">{header as never}</View>;
    },
  };
});

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
    { _layout: Layout, 'user/[id]/index': UserProfileScreen, '(tabs)/profile/index': Stub },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

beforeEach(() => {
  mockScrollToIndex.mockClear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

async function jules() {
  const page = await api.profile.searchUsers({ q: 'friend_a' });
  return page.items.find((u) => u.handle === 'friend_a')!;
}

describe("another user's Bev'd count", () => {
  it('is a 44pt button that switches to the Activity tab when another tab is showing', async () => {
    const j = await jules();
    const s = await api.stats.getUser(j.id);
    const r = await open(`/user/${j.id}?tab=taste`);
    const bevd = await screen.findByLabelText(`Bev'd, ${s.bevdCount}, show their rankings`);
    expect(bevd.props.accessibilityRole).toBe('button');
    expect((StyleSheet.flatten(bevd.props.style) as ViewStyle).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(bevd);
    await waitFor(() => expect(r.path()).toContain('tab=activity'));
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('scrolls the Activity list to its first ranking when already on Activity', async () => {
    const j = await jules();
    const s = await api.stats.getUser(j.id);
    expect(s.bevdCount).toBeGreaterThan(0);
    await open(`/user/${j.id}`);
    await fireEvent.press(await screen.findByLabelText(`Bev'd, ${s.bevdCount}, show their rankings`));
    expect(mockScrollToIndex).toHaveBeenCalledWith({ index: 0, animated: true });
  });

  it('is plain text, not a button, when they have no rankings and Activity is already showing', async () => {
    const j = await jules();
    const s = await api.stats.getUser(j.id);
    jest.spyOn(api.stats, 'getUser').mockResolvedValue({ ...s, bevdCount: 0 });
    await open(`/user/${j.id}`);
    const bevd = await screen.findByLabelText("Bev'd, 0");
    expect(bevd.props.accessibilityRole).toBeUndefined();
    expect(screen.queryByLabelText("Bev'd, 0, show their rankings")).toBeNull();
    expect(screen.queryByRole('button', { name: /show their rankings/ })).toBeNull();
    await fireEvent.press(bevd);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('with no rankings on another tab it is still the button that switches to Activity', async () => {
    const j = await jules();
    const s = await api.stats.getUser(j.id);
    jest.spyOn(api.stats, 'getUser').mockResolvedValue({ ...s, bevdCount: 0 });
    const r = await open(`/user/${j.id}?tab=taste`);
    const bevd = await screen.findByLabelText("Bev'd, 0, show their rankings");
    expect(bevd.props.accessibilityRole).toBe('button');
    await fireEvent.press(bevd);
    await waitFor(() => expect(r.path()).toContain('tab=activity'));
    // Now on Activity with nothing in it: plain text.
    expect(await screen.findByLabelText("Bev'd, 0")).toBeTruthy();
    expect(screen.queryByLabelText("Bev'd, 0, show their rankings")).toBeNull();
  });
});

describe('ProfileHero Bev\'d count without a handler', () => {
  const profile = { displayName: 'Friend A', handle: 'friend_a', avatarUrl: null, createdAt: '2026-10-01T00:00:00Z' };
  const stats = { bevdCount: 12, followers: 3, following: 4 } as never;

  it('is plain text, not a button', async () => {
    await render(<ProfileHero profile={profile} stats={stats} />);
    const bevd = screen.getByLabelText("Bev'd, 12");
    expect(bevd.props.accessibilityRole).toBeUndefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

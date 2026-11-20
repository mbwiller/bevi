import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import BevDetailScreen from '@/app/bev/[id]';
import UserProfileScreen from '@/app/user/[id]/index';
import { spacing } from '@/theme';
import { controls } from '@/testing/fakeApi';

import { SettingsScreen } from '../SettingsRow';

// A pushed screen has no tab bar, so the end of its scroll has to clear the home indicator itself.
// Jest resolves as iOS.

const { width, height } = Dimensions.get('window');
const HOME_INDICATOR = 34;

let client: QueryClient;

function Layout() {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: 0, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
      <QueryClientProvider client={client}>
        <Slot />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const Stub = () => null;

/** The `contentContainerStyle` of the ScrollViews around the node, nearest first. */
function ancestors(node: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let n = node as { parent: unknown; props: { contentContainerStyle?: unknown } } | null;
  while (n) {
    if (n.props?.contentContainerStyle) out.push(StyleSheet.flatten(n.props.contentContainerStyle as never) as Record<string, unknown>);
    n = n.parent as typeof n;
  }
  return out;
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

it('settings: the body pads its end by xxl plus the home-indicator inset', async () => {
  await renderRouter(
    {
      _layout: Layout,
      index: () => (
        <SettingsScreen title="Privacy">
          <Text>Body</Text>
        </SettingsScreen>
      ),
    },
    { initialUrl: '/' },
  );
  const padded = ancestors(await screen.findByText('Body')).map((s) => s.paddingBottom);
  expect(padded).toContain(spacing.xxl + HOME_INDICATOR);
});

it('a Bev: the scroll pads its end by xxl plus the home-indicator inset', async () => {
  const ranked = (await api.rankings.listMine()).items[0]!;
  await renderRouter({ _layout: Layout, 'bev/[id]': BevDetailScreen, 'rank/[bevId]': Stub, 'image/[url]': Stub, add: Stub }, { initialUrl: `/bev/${ranked.bevId}` });
  const padded = ancestors(await screen.findByText('Your score')).map((s) => s.paddingBottom);
  expect(padded).toContain(spacing.xxl + HOME_INDICATOR);
});

it("another person's profile: the list's foot is xxl plus the home-indicator inset tall", async () => {
  const friend = (await api.profile.searchUsers({ q: 'friend_a' })).items.find((u) => u.handle === 'friend_a')!;
  await renderRouter(
    { _layout: Layout, 'user/[id]/index': UserProfileScreen, 'user/[id]/followers': Stub, 'user/[id]/following': Stub, 'bev/[id]': Stub },
    { initialUrl: `/user/${friend.id}` },
  );
  const foot = await screen.findByTestId('activity-foot', { includeHiddenElements: true });
  expect(StyleSheet.flatten(foot.props.style).height).toBe(spacing.xxl + HOME_INDICATOR);
});

import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { TabBar, type TabId } from '@/components/TabBar';
import { useSession } from '@/state/session';

// The 5 tabs. One agent at a time owns this file and the root _layout.tsx (app/CLAUDE.md).

type TabBarRenderProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** TabBar ids → the tab routes in this folder (URLs /feed, /lists, /add, /leaderboard, /profile). */
const TAB_ROUTES = {
  feed: 'feed/index',
  lists: 'lists/index',
  add: 'add/index',
  leaderboard: 'leaderboard/index',
  profile: 'profile/index',
} as const satisfies Record<TabId, string>;

const TAB_IDS = Object.keys(TAB_ROUTES) as TabId[];

function tabIdFor(routeName: string | undefined): TabId {
  return TAB_IDS.find((id) => TAB_ROUTES[id] === routeName) ?? 'feed';
}

/** Our TabBar in place of the navigator's default bar. */
function AppTabBar({ state, navigation }: TabBarRenderProps) {
  const profile = useSession((s) => s.profile);
  const focused = state.routes[state.index];
  const active = tabIdFor(focused?.name);
  return (
    <TabBar
      active={active}
      safeArea
      user={profile ? { name: profile.displayName, src: profile.avatarUrl ?? undefined } : undefined}
      onChange={(id) => {
        const route = state.routes.find((r) => r.name === TAB_ROUTES[id]);
        if (!route) return;
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (route.key !== focused?.key && !event.defaultPrevented) navigation.navigate(route.name, route.params);
      }}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      {TAB_IDS.map((id) => (
        <Tabs.Screen key={id} name={TAB_ROUTES[id]} />
      ))}
    </Tabs>
  );
}

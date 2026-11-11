import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { TabBar, type TabId } from '@/components/TabBar';
import { useSession } from '@/state/session';

// The 5 tabs, plus People (/people), which keeps the bar but is not a tab. One agent at a time owns
// this file and the root _layout.tsx (app/CLAUDE.md).

type TabBarRenderProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** TabBar ids → the tab routes in this folder (URLs /feed, /lists, /add, /map, /profile). `add` is the Add Bev tab. */
const TAB_ROUTES = {
  feed: 'feed/index',
  lists: 'lists/index',
  add: 'add/index',
  map: 'map/index',
  profile: 'profile/index',
} as const satisfies Record<TabId, string>;

const TAB_IDS = Object.keys(TAB_ROUTES) as TabId[];

/**
 * Screens in this group that are not tabs: they keep the bar under them but add no item to it.
 * People (`/people`) is opened from the Feed's Find people, so the bar marks Feed while it shows
 * (design system ScreenPeople).
 */
const NON_TAB_ROUTES = { 'people/index': 'feed' } as const satisfies Record<string, TabId>;

function tabIdFor(routeName: string | undefined): TabId {
  const tab = TAB_IDS.find((id) => TAB_ROUTES[id] === routeName);
  if (tab) return tab;
  if (routeName && routeName in NON_TAB_ROUTES) return NON_TAB_ROUTES[routeName as keyof typeof NON_TAB_ROUTES];
  return 'feed';
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
      {Object.keys(NON_TAB_ROUTES).map((name) => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  );
}

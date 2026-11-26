import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBevdMap, useLocationSummary } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { Skeleton } from '@/components/Skeleton';
import { size, spacing, type, useTheme } from '@/theme';

import { BevdCanvas } from './BevdCanvas';
import { BevdPlaceSheet } from './BevdPlaceSheet';
import {
  ADD_LOCATIONS,
  ADD_THEM,
  MAP_EMPTY_ACTION,
  MAP_EMPTY_BODY,
  MAP_EMPTY_FRIENDS,
  MAP_EMPTY_TITLE,
  MAP_TITLE,
  backfillLine,
} from './copy';
import type { MapScope } from './openPlace';
import { PlaceBevsSheet } from './PlaceBevsSheet';

const SCOPES = [
  { id: 'mine', label: 'You' },
  { id: 'friends', label: 'Friends' },
] as const satisfies readonly { id: MapScope; label: string }[];

const parseScope = (id: string | undefined): MapScope => (id === 'friends' ? 'friends' : 'mine');

/**
 * The Map tab (BEV-22): where you had your Bevs, and under Friends where the people you follow had
 * theirs. One pin per place; a pin opens what was had there. `?venue=<id>&scope=<mine|friends>` (a
 * post's place line) opens on that place in that view.
 *
 * The map is only as full as the list is tagged, so while some of the viewer's Bevs have no place
 * a line under the tabs says how many, and "Add them" opens a sheet over the map that goes through
 * them one at a time (`PlaceBevsSheet`).
 */
export function BevdMapScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ venue?: string; scope?: string }>();
  const [scope, setScope] = useState<MapScope>('mine');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const pins = useBevdMap(scope);
  const summary = useLocationSummary();

  // A place line was tapped: open on that venue, in the view the post's author is in, and drop the
  // params so tapping the same place again later still arrives as a change.
  const wanted = typeof params.venue === 'string' ? params.venue : '';
  const wantedScope = parseScope(typeof params.scope === 'string' ? params.scope : undefined);
  useEffect(() => {
    if (!wanted) return;
    setScope(wantedScope);
    setSelected(wanted);
    router.setParams({ venue: undefined, scope: undefined });
  }, [wanted, wantedScope, router]);

  const data = useMemo(() => pins.data ?? [], [pins.data]);
  const seed = data.find((p) => p.venue.id === selected) ?? null;
  const nudge = backfillLine(summary.data);
  const toBevd = () => router.push('/lists');
  const addThem = () => {
    setSelected(null);
    setAdding(true);
  };

  let body;
  if (pins.isPending) {
    body = (
      <View style={styles.pad} testID="bevd-map-loading">
        <Skeleton variant="block" height={160} />
        <Skeleton variant="text" lines={3} />
      </View>
    );
  } else if (pins.error && data.length === 0) {
    body = <ErrorState error={pins.error} onRetry={() => void pins.refetch()} />;
  } else if (data.length === 0) {
    body = (
      <View style={styles.empty}>
        {scope === 'friends' ? (
          <EmptyState icon="map-pin" title={MAP_EMPTY_TITLE} body={MAP_EMPTY_FRIENDS} />
        ) : (
          <EmptyState
            icon="map-pin"
            title={MAP_EMPTY_TITLE}
            body={MAP_EMPTY_BODY}
            action={nudge ? ADD_LOCATIONS : MAP_EMPTY_ACTION}
            onAction={nudge ? addThem : toBevd}
          />
        )}
      </View>
    );
  } else {
    body = <BevdCanvas pins={data} selectedId={selected} onSelect={setSelected} onClear={() => setSelected(null)} />;
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={MAP_TITLE} />
      <SegmentedTabs
        variant="underline-text"
        tabs={[...SCOPES]}
        value={scope}
        onChange={(id) => {
          setSelected(null);
          setScope(parseScope(id));
        }}
      />
      {nudge ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${nudge} ${ADD_THEM}`}
          onPress={addThem}
          style={({ pressed }) => [styles.nudge, { backgroundColor: colors.primaryTint }, pressed && PRESSED]}
          testID="bevd-map-nudge"
        >
          <Icon name="map-pin" size={16} strokeWidth={2} color={colors.primary} />
          <Text style={[type.body, styles.nudgeText, { color: colors.text }]} numberOfLines={2}>
            {nudge}
          </Text>
          <Text style={[type.body, styles.nudgeAction, { color: colors.primary }]}>{ADD_THEM}</Text>
        </Pressable>
      ) : null}
      <View style={styles.body}>{body}</View>
      <BevdPlaceSheet venueId={selected} scope={scope} seed={seed} onClose={() => setSelected(null)} />
      <PlaceBevsSheet open={adding} onClose={() => setAdding(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  pad: { padding: spacing.gutter, gap: spacing.lg },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  nudge: {
    minHeight: size.target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  nudgeText: { flex: 1, minWidth: 0 },
  nudgeAction: { fontWeight: '600' },
});

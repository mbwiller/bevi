import type { BevdScope } from '@bevi/shared';
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
import { MAP_EMPTY_ACTION, MAP_EMPTY_BODY, MAP_EMPTY_FRIENDS, MAP_EMPTY_TITLE, MAP_TITLE, backfillLine } from './copy';

const SCOPES = [
  { id: 'all', label: 'Everyone' },
  { id: 'mine', label: 'You' },
  { id: 'friends', label: 'Friends' },
] as const satisfies readonly { id: BevdScope; label: string }[];

const parseScope = (id: string): BevdScope => (id === 'mine' || id === 'friends' ? id : 'all');

/**
 * The Map tab (BEV-22): where you and the people you follow had your Bevs. One pin per place; a pin
 * opens what was had there. `?venue=<id>` (a post's place line) opens on that place.
 *
 * The map is only as full as the list is tagged, so while some of the viewer's Bevs have no place
 * a line under the tabs says how many and leads to Bev'd, where each row can be given one.
 */
export function BevdMapScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ venue?: string }>();
  const [scope, setScope] = useState<BevdScope>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const pins = useBevdMap(scope);
  const summary = useLocationSummary();

  // A place line was tapped: open on that venue, in the widest scope so it is there, and drop the
  // param so tapping the same place again later still arrives as a change.
  const wanted = typeof params.venue === 'string' ? params.venue : '';
  useEffect(() => {
    if (!wanted) return;
    setScope('all');
    setSelected(wanted);
    router.setParams({ venue: undefined });
  }, [wanted, router]);

  const data = useMemo(() => pins.data ?? [], [pins.data]);
  const seed = data.find((p) => p.venue.id === selected) ?? null;
  const nudge = backfillLine(summary.data);
  const toBevd = () => router.push('/lists');

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
          <EmptyState icon="map-pin" title={MAP_EMPTY_TITLE} body={MAP_EMPTY_BODY} action={MAP_EMPTY_ACTION} onAction={toBevd} />
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
          accessibilityLabel={`${nudge} Add them in Bev'd`}
          onPress={toBevd}
          style={({ pressed }) => [styles.nudge, { backgroundColor: colors.primaryTint }, pressed && PRESSED]}
          testID="bevd-map-nudge"
        >
          <Icon name="map-pin" size={16} strokeWidth={2} color={colors.primary} />
          <Text style={[type.body, styles.nudgeText, { color: colors.text }]} numberOfLines={2}>
            {nudge}
          </Text>
          <Text style={[type.body, styles.nudgeAction, { color: colors.primary }]}>Add them</Text>
        </Pressable>
      ) : null}
      <View style={styles.body}>{body}</View>
      <BevdPlaceSheet venueId={selected} scope={scope} seed={seed} onClose={() => setSelected(null)} />
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

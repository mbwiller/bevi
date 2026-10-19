import type { BevSummary } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAddWantToTry, useBev, useRemoveWantToTry } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import type { RecentBev } from '@/features/add-bev/recents';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

/**
 * Where a Bev from search goes (§6.8): tapping it starts ranking it, or opens its detail when you've
 * already ranked it. Until the row knows (`ranked` undefined) the rank screen decides
 * (`entry=search`). `remember` adds it to Recents first.
 */
export function useOpenBev(remember: (bev: RecentBev) => void) {
  const router = useRouter();
  const open = useCallback(
    (bev: RecentBev, ranked?: boolean) => {
      remember(bev);
      if (ranked) router.push({ pathname: '/bev/[id]', params: { id: bev.id } });
      else router.push({ pathname: '/rank/[bevId]', params: ranked === false ? { bevId: bev.id } : { bevId: bev.id, entry: 'search' } });
    },
    [remember, router],
  );
  const rank = useCallback(
    (bev: BevSummary) => {
      remember(bev);
      router.push({ pathname: '/rank/[bevId]', params: { bevId: bev.id } });
    },
    [remember, router],
  );
  return { open, rank };
}

/**
 * A search result. `BevSummary` has no per-viewer fields, so the row reads the Bev's detail
 * (`useBev`, only for rows on screen) for the bookmark and whether you've ranked it.
 */
export function ResultRow({ bev, onOpen, onRank }: { bev: BevSummary; onOpen: (ranked: boolean | undefined) => void; onRank: () => void }) {
  const detail = useBev(bev.id);
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();
  const saved = detail.data?.inWantToTry ?? false;
  return (
    <BevRow
      bev={bev}
      showImage
      score={bev.bayesScore}
      count={bev.ratingCount}
      saved={saved}
      onPress={() => onOpen(detail.data ? !!detail.data.myRanking : undefined)}
      onRank={onRank}
      onSave={() => (saved ? remove.mutate(bev.id) : add.mutate({ bevId: bev.id }))}
    />
  );
}

/** A Bev you opened before, with a button to forget it. */
export function RecentRow({ bev, onPress, onForget }: { bev: RecentBev; onPress: () => void; onForget: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.recent, { borderBottomColor: colors.border }]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={bev.name} style={styles.recentMain}>
        <Icon name="clock" size={22} color={colors.textSecondary} />
        <View style={styles.recentText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} style={[type.bodyLarge, { color: colors.text }]} numberOfLines={1}>
            {bev.name}
          </Text>
          {bev.brand ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
              {bev.brand}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <IconButton icon="x" label={`Forget ${bev.name}`} size={20} onPress={onForget} />
    </View>
  );
}

/** The design system's recents row `{ min-height: 62px }`: no token names it. */
const RECENT_MIN = 62;

const styles = StyleSheet.create({
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: RECENT_MIN,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.sm,
    borderBottomWidth: 1,
  },
  // The recents row `{ gap: 14px }`.
  recentMain: { flex: 1, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: 14 },
  recentText: { flex: 1, minWidth: 0 },
});

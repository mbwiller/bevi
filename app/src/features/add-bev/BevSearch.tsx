import type { BevSummary } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBevSearch, useMe } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { SearchBar } from '@/components/SearchBar';
import { Skeleton } from '@/components/Skeleton';
import { visibleCategories } from '@/lib/categories';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { useRecents, type RecentBev } from './recents';
import { useDebouncedValue } from './useDebouncedValue';

const SKELETON_ROWS = 4;
const ADD_NEW = "Can't find it? Add a new Bev";

/**
 * The Bevs tab of Add Bev (DEVELOPMENT-MATT §6.8, design system ScreenAddBev): outlined search,
 * debounced 250ms; Recents while idle; results as BevRows (tap → detail, plus → rank); a sticky
 * "Can't find it? Add a new Bev" that turns primary when nothing matches.
 */
export function BevSearch() {
  const router = useRouter();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim());
  const { recents, remember, forget } = useRecents();
  const me = useMe();
  const search = useBevSearch(query, undefined, { enabled: query.length > 0 });

  // The server already age-filters; this keeps the alcoholic three out even if a result slips through.
  const allowed = useMemo(() => new Set(visibleCategories(me.data?.canSeeAlcohol ?? false).map((c) => c.id)), [me.data?.canSeeAlcohol]);
  const results = useMemo(() => (search.data?.items ?? []).filter((b) => allowed.has(b.categoryId)), [search.data, allowed]);

  const idle = q.trim().length === 0;
  const settled = !idle && query === q.trim();
  const noResults = settled && search.isSuccess && !search.isPlaceholderData && results.length === 0;

  const openBev = (bev: RecentBev) => {
    remember(bev);
    router.push({ pathname: '/bev/[id]', params: { id: bev.id } });
  };
  const rankBev = (bev: BevSummary) => {
    remember(bev);
    router.push({ pathname: '/rank/[bevId]', params: { bevId: bev.id } });
  };
  const addNew = () => router.push('/add/new');

  let body;
  if (idle) {
    body = recents.length ? (
      <View>
        <Text style={[type.heading, styles.recentsTitle, { color: colors.text }]} accessibilityRole="header">
          Recents
        </Text>
        {recents.map((r) => (
          <RecentRow key={r.id} bev={r} onPress={() => openBev(r)} onForget={() => forget(r.id)} />
        ))}
      </View>
    ) : (
      <EmptyState icon="search" title="Find a Bev to rank" body="Search by name, brand or flavor." />
    );
  } else if (search.isError && !search.data) {
    body = <ErrorState error={search.error} onRetry={() => void search.refetch()} />;
  } else if (!search.data) {
    body = (
      <View accessibilityLabel="Loading results" aria-busy>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} variant="row" />
        ))}
      </View>
    );
  } else if (noResults) {
    body = <EmptyState icon="search" title={`No Bevs match "${query}"`} body="Check the spelling, or add it to Bevi." />;
  } else {
    body = (
      <FlashList
        data={results}
        keyExtractor={(b) => b.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <BevRow
            bev={item}
            showImage
            score={item.bayesScore}
            count={item.ratingCount}
            onPress={() => openBev(item)}
            onRank={() => rankBev(item)}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.query}>
        <SearchBar variant="outlined" placeholder="Search a Bev, brand or flavor" value={q} onChange={setQ} autoFocus id="add-q" />
      </View>
      <View style={styles.pills}>
        <Pill variant="filled" icon="camera" onPress={addNew} accessibilityLabel="Snap it: add a Bev from a photo">
          Snap it
        </Pill>
      </View>
      <View style={styles.body}>{body}</View>
      <View style={[styles.foot, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Button variant={noResults ? 'primary' : 'outlined'} block icon="circle-plus" onPress={addNew}>
          {ADD_NEW}
        </Button>
      </View>
    </View>
  );
}

function RecentRow({ bev, onPress, onForget }: { bev: RecentBev; onPress: () => void; onForget: () => void }) {
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

/** ScreenAddBev `.recent { min-height: 62px }`: no token names it. */
const RECENT_MIN = 62;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  query: { paddingTop: spacing.lg, paddingBottom: spacing.md, paddingHorizontal: spacing.gutter },
  pills: { flexDirection: 'row', paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  body: { flex: 1 },
  recentsTitle: { fontWeight: '700', paddingTop: spacing.md, paddingBottom: spacing.xs, paddingHorizontal: spacing.gutter },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: RECENT_MIN,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.sm,
    borderBottomWidth: 1,
  },
  // ScreenAddBev `.recent { gap: 14px }`.
  recentMain: { flex: 1, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: 14 },
  recentText: { flex: 1, minWidth: 0 },
  foot: { paddingVertical: spacing.md, paddingHorizontal: spacing.gutter, borderTopWidth: 1 },
});

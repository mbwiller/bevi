import { MAX_CATEGORY_PICKS, type CategoryId, type Profile } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategoryPicks, useMe, useSetCategoryPicks, useStarterCandidates } from '@/api/hooks';
import { bevArtForCategory } from '@/components/BevArt';
import { bevImageProps } from '@/components/BevParts';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { PickTile } from '@/components/PickTile';
import { Skeleton } from '@/components/Skeleton';
import { FormError } from '@/features/auth/AuthScreen';
import { formErrorMessage } from '@/features/auth/formError';
import type { CategoryInfo } from '@/lib/categories';
import { useAnnounce } from '@/lib/useAnnounce';
import { useBack } from '@/lib/useBack';
import { spacing, type, useTheme } from '@/theme';

import { PICKS_COPY, helperLine } from './copy';
import { artBevsByCategory, pickableCategories, prefillPicks, rankOf, samePicks, togglePick } from './selection';

/** The grid's columns: three tiles read well on a 375pt phone and fill the capped column on the web. */
const COLUMNS = 3;
/** The same column cap as the profile step, so the grid never stretches across a wide window. */
const COLUMN_MAX = 420;
/** About a tile's height (BevImage 56, a line of label, the padding), for the loading skeleton. */
const SKELETON_TILE = 108;
const SKELETON_ROWS = 3;

/**
 * §6.2a Onboarding, between the profile and the starter ranking: the user taps up to three drink
 * categories, favorite first, and the tap order is the ranking. Continue saves them
 * (`profile.setCategoryPicks`, skipped when nothing changed) and opens the starter ranking, which
 * leads with Bevs from these categories. A returning user sees their saved picks again.
 */
export function PicksScreen() {
  const { colors } = useTheme();
  const back = useBack();
  const me = useMe();
  const savedQ = useCategoryPicks();

  const retry = () => {
    if (me.isError) void me.refetch();
    if (savedQ.isError) void savedQ.refetch();
  };
  const blocking = (me.isError && !me.data ? me.error : null) ?? (savedQ.isError && !savedQ.data ? savedQ.error : null);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <Header title={PICKS_COPY.header} onBack={back} />
      {me.data && savedQ.data ? (
        <PicksForm me={me.data} saved={savedQ.data} />
      ) : blocking ? (
        <ErrorState error={blocking} onRetry={retry} style={styles.fill} />
      ) : (
        <View style={[styles.body, styles.column]} accessibilityLabel={PICKS_COPY.loading} aria-busy>
          <Skeleton variant="text" lines={2} />
          {Array.from({ length: SKELETON_ROWS }, (_, r) => (
            <View key={r} style={styles.row}>
              {Array.from({ length: COLUMNS }, (_, c) => (
                <View key={c} style={styles.cell}>
                  <Skeleton variant="block" height={SKELETON_TILE} />
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

function PicksForm({ me, saved }: { me: Profile; saved: readonly CategoryId[] }) {
  const { colors } = useTheme();
  const router = useRouter();
  const setCategoryPicks = useSetCategoryPicks();
  // Only for the tiles' art (the next screen needs these anyway); while they load, or if they fail,
  // every tile shows its category's own art and nothing here waits on them.
  const candidatesQ = useStarterCandidates();

  const categories = useMemo(() => pickableCategories(me.canSeeAlcohol), [me.canSeeAlcohol]);
  const rows = useMemo(() => chunk(categories, COLUMNS), [categories]);
  const artBevs = useMemo(() => artBevsByCategory(candidatesQ.data ?? []), [candidatesQ.data]);
  const [picks, setPicks] = useState<readonly CategoryId[]>(() => prefillPicks(saved, categories.map((c) => c.id)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const full = picks.length >= MAX_CATEGORY_PICKS;
  const helper = helperLine(picks.length);
  // VoiceOver hears each tile's new name on a tap; the full state also says what to do next.
  useAnnounce(full ? helper : null);

  const tap = useCallback((id: CategoryId) => setPicks((p) => togglePick(p, id)), []);

  const submit = async () => {
    if (picks.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!samePicks(picks, saved)) await setCategoryPicks.mutateAsync([...picks]);
      router.push('/onboarding/starter');
    } catch (e) {
      setError(formErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const tile = (c: CategoryInfo) => {
    const bev = artBevs.get(c.id);
    const image = bev ? bevImageProps(bev) : { src: undefined, art: bevArtForCategory(c.id) };
    const rank = rankOf(picks, c.id);
    return (
      <PickTile
        key={c.id}
        label={c.label}
        src={image.src}
        art={image.art}
        rank={rank}
        disabled={full && !rank}
        onPress={() => tap(c.id)}
        style={styles.cell}
      />
    );
  };

  return (
    <>
      <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
        <View style={styles.column}>
          <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
            {PICKS_COPY.title}
          </Text>
          <Text style={[type.bodyLarge, { color: colors.text }]}>{PICKS_COPY.body}</Text>
          <View style={styles.grid}>
            {rows.map((row, r) => (
              <View key={r} style={styles.row}>
                {row.map(tile)}
                {/* The last row keeps the others' column widths. */}
                {Array.from({ length: COLUMNS - row.length }, (_, i) => (
                  <View key={`gap-${i}`} style={styles.cell} />
                ))}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      {/* Held under the grid, so Continue is always in reach however far it scrolls. */}
      <View style={[styles.foot, { borderTopColor: colors.border }]}>
        <View style={styles.column}>
          <Text style={[type.body, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
            {helper}
          </Text>
          <FormError>{error}</FormError>
          <Button variant="primary" block disabled={picks.length === 0} loading={saving} onPress={() => void submit()}>
            {PICKS_COPY.continue}
          </Button>
        </View>
      </View>
    </>
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flexGrow: 1, padding: spacing.gutter },
  column: { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center', gap: spacing.lg },
  grid: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, minWidth: 0 },
  foot: { padding: spacing.gutter, borderTopWidth: 1 },
});

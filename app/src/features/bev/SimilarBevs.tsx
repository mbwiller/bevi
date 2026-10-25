import type { BevSummary } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useMe, useSimilarBevs } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { SectionHeader } from '@/components/SectionHeader';
import { categoryById } from '@/lib/categories';
import { spacing } from '@/theme';

/**
 * What the row shows: never the Bev it sits under, and never an alcoholic Bev to someone who can't see
 * alcohol (the server already filters by age; this covers a stale cache and `me` still loading).
 */
export function visibleSimilar(items: readonly BevSummary[] | undefined, bevId: string, canSeeAlcohol: boolean): BevSummary[] {
  return (items ?? []).filter((b) => b.id !== bevId && (canSeeAlcohol || !categoryById(b.categoryId)?.isAlcoholic));
}

/**
 * "Bevs like this" (M-27): up to five BevRows with images, most similar first, from `bevs.similar`. Secondary
 * content, so it renders nothing while loading, when the request fails, and when there are no neighbours: it sits
 * below the buttons, so it appearing never moves what's already on screen.
 */
export function SimilarBevs({ bevId }: { bevId: string }) {
  const router = useRouter();
  const query = useSimilarBevs(bevId);
  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;
  const items = visibleSimilar(query.data, bevId, canSeeAlcohol);
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Bevs like this" />
      {items.map((bev, i) => (
        <BevRow
          key={bev.id}
          bev={bev}
          showImage
          actions={false}
          score={bev.bayesScore}
          count={bev.ratingCount}
          divider={i < items.length - 1}
          onPress={() => router.push({ pathname: '/bev/[id]', params: { id: bev.id } })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
});

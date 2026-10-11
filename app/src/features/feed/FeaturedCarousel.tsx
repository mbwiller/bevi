import type { FeaturedBev } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useFeatured, useMe } from '@/api/hooks';
import { bevArtForCategory } from '@/components/BevArt';
import { FeaturedCard } from '@/components/FeaturedCard';
import { priceTierText } from '@/components/PriceTier';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { size, spacing } from '@/theme';

/** §6.4: a single featured Bev reads "Boba • $$" (its category and price). */
export function featuredSubtitle({ bev }: FeaturedBev): string {
  const cat = categoryById(bev.categoryId);
  return [cat?.label, priceTierText(bev.priceTier, bev.priceEstimated)].filter(Boolean).join(' • ');
}

const SKELETON_CARDS = 3;

/**
 * "FEATURED BEVS" and its horizontal FeaturedCard carousel. The hero image when there is one, else the
 * Bev's own photo, else BevArt for its category. Featured is a nice-to-have above the feed, so an
 * error or an empty list hides the section instead of competing with the feed's own states.
 */
export function FeaturedCarousel() {
  const router = useRouter();
  const featured = useFeatured();
  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;
  // The server age-filters featured already; hide alcohol client-side too (§6.17).
  const items = (featured.data ?? []).filter((f) => canSeeAlcohol || !categoryById(f.bev.categoryId)?.isAlcoholic);
  if (featured.isError || (featured.isSuccess && items.length === 0)) return null;

  return (
    <View>
      <SectionHeader title="Featured Bevs" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityLabel="Featured Bevs"
        testID="featured-carousel"
      >
        {featured.isPending
          ? Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} variant="block" width={size.featuredCard} height={size.featuredCard} />
            ))
          : items.map((f) => {
              const src = f.heroImageUrl || f.bev.photoUrl || undefined;
              return (
                <FeaturedCard
                  key={f.bev.id}
                  title={f.bev.name}
                  subtitle={featuredSubtitle(f)}
                  src={src}
                  art={src ? undefined : bevArtForCategory(f.bev.categoryId)}
                  onPress={() => router.push({ pathname: '/bev/[id]', params: { id: f.bev.id } })}
                />
              );
            })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.sm },
});

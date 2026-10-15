import { BUCKET_ORDER, type Bev, type Bucket } from '@bevi/shared';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BevArt, bevArtForCategory } from '@/components/BevArt';
import { brandLine } from '@/components/BevParts';
import { BucketButton } from '@/components/BucketButton';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PriceTier } from '@/components/PriceTier';
import { categoryById } from '@/lib/categories';
import { size, spacing, type, useTheme } from '@/theme';

export interface GutCheckProps {
  bev: Bev;
  /** The bucket being poured, once chosen. */
  chosen: Bucket | null;
  onChoose: (bucket: Bucket) => void;
  onClose: () => void;
}

// ScreenGutCheck geometry: the cutout floats at 200pt; buckets 14pt apart; 36pt above the question.
const ART = 200;
const BUCKET_GAP = 14;
const QUESTION_TOP = 36;

/**
 * Ranking flow step 1 (design system ScreenGutCheck): the Bev floating on its own BevGlow (the
 * route draws the glow behind this), "How was it?" and the three BucketButtons.
 */
export function GutCheck({ bev, chosen, onChoose, onClose }: GutCheckProps) {
  const { colors } = useTheme();
  const cat = categoryById(bev.categoryId);
  const brand = brandLine(bev);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.top}>
        <IconButton icon="x" label="Discard ranking" variant="filled" onPress={onClose} />
      </View>
      <View style={styles.hero}>
        <View style={styles.art} accessible accessibilityRole="image" accessibilityLabel={bev.name}>
          {bev.photoUrl ? (
            <Image
              source={{ uri: bev.photoUrl }}
              style={styles.fill}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={bev.id}
              accessible={false}
            />
          ) : (
            <BevArt {...bevArtForCategory(bev.categoryId)} />
          )}
        </View>
        <Text style={[type.screenTitle, styles.name, { color: colors.text }]} accessibilityRole="header">
          {bev.name}
        </Text>
        {brand ? <Text style={[type.body, { color: colors.textSecondary }]}>{brand}</Text> : null}
        <View style={styles.cat}>
          {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.text} /> : null}
          <Text style={[type.body, { color: colors.text }]}>
            {cat ? `${cat.label} • ` : ''}
            <PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} />
          </Text>
        </View>
      </View>
      <Text style={[type.displayDrop, styles.question, { color: colors.text }]}>How was it?</Text>
      <View style={styles.buckets}>
        {BUCKET_ORDER.map((b) => (
          <BucketButton key={b} bucket={b} selected={chosen === b} onPress={() => onChoose(b)} />
        ))}
      </View>
      <Text style={[type.caption, styles.hint, { color: colors.textSecondary }]}>
        Next, you&apos;ll compare it with Bevs you&apos;ve already ranked.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  top: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', height: size.header, paddingHorizontal: spacing.sm },
  hero: { alignItems: 'center', paddingTop: spacing.sm, paddingHorizontal: spacing.gutter },
  art: { width: ART, height: ART, alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  name: { marginTop: spacing.md, textAlign: 'center' },
  cat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  question: { marginTop: QUESTION_TOP, marginBottom: spacing.lg, marginHorizontal: spacing.gutter },
  buckets: { gap: BUCKET_GAP, paddingHorizontal: spacing.gutter },
  hint: { marginTop: spacing.xl, marginHorizontal: spacing.gutter, textAlign: 'center' },
});

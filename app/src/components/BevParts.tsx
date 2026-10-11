import type { BevSummary } from '@bevi/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { bevArtForCategory } from './BevArt';
import type { BevImageProps } from './BevImage';
import { TARGET_MIN } from './HitTarget';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

// Pieces BevRow, FeedPost and CompareCard share.

/** A Bev's BevImage props: the cutout when it has one, else its category's BevArt; shimmer while processing. */
export function bevImageProps(bev: BevSummary): Pick<BevImageProps, 'src' | 'art' | 'alt' | 'status'> {
  return {
    src: bev.photoUrl ?? undefined,
    art: bev.photoUrl ? undefined : bevArtForCategory(bev.categoryId),
    alt: bev.name,
    status: bev.photoStatus,
  };
}

/** "Brand · Flavor", dropping "Original" and missing parts (design system `brandLine`). */
export function brandLine(bev: Pick<BevSummary, 'brand' | 'flavor'>): string {
  return [bev.brand, bev.flavor && bev.flavor !== 'Original' ? bev.flavor : null].filter(Boolean).join(' · ');
}

/** The Want to Try bookmark: `primary` and filled once saved. */
export function SaveButton({ saved, onPress }: { saved: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Saved to Want to Try' : 'Save to Want to Try'}
      // react-native-web drops accessibilityState.selected/checked for buttons; aria-pressed renders.
      {...({ 'aria-pressed': saved } as object)}
      style={TARGET_MIN}
    >
      <Icon name="bookmark" size={28} strokeWidth={1.6} filled={saved} color={saved ? colors.primary : colors.text} />
    </Pressable>
  );
}

/**
 * Rank it and Want to Try, as on every row and post. Each shows only with its handler, so a screen
 * drops Rank for an alcoholic Bev an under-21 viewer can't rank by not passing `onRank`.
 */
export function BevActions({ name, saved, onRank, onSave }: { name: string; saved: boolean; onRank?: () => void; onSave?: () => void }) {
  return (
    <View style={styles.actions}>
      {onRank ? <IconButton icon="circle-plus" label={`Rank ${name}`} onPress={onRank} /> : null}
      {onSave ? <SaveButton saved={saved} onPress={onSave} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // bundle.css `.bv-actions { margin-right: -8px }`: the 28pt glyph lines up with the gutter.
  actions: { flexDirection: 'row', alignItems: 'center', marginRight: -8 },
});

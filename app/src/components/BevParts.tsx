import type { BevSummary } from '@bevi/shared';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { bevArtForCategory } from './BevArt';
import type { BevImageProps } from './BevImage';
import { TARGET_MIN } from './HitTarget';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { FeedbackPressable } from './PressFeedback';
import { usePop } from './usePop';

// Pieces BevRow, FeedPost and CompareCard share.

/**
 * A Bev's BevImage props, photo > icon > category art: its cutout when it has one, else its authored
 * icon (`iconUrl`, served from the `bev-icons` bucket), else its category's BevArt; shimmer while
 * processing. The one place this precedence lives: screens that draw a Bev's image use this rather
 * than reading `photoUrl` or `iconUrl`. `??` also covers a BevSummary cached before contract 2.13.0,
 * whose `iconUrl` is undefined.
 */
export function bevImageProps(bev: BevSummary): Pick<BevImageProps, 'src' | 'art' | 'alt' | 'status'> {
  const src = bev.photoUrl ?? bev.iconUrl ?? undefined;
  return {
    src,
    art: src ? undefined : bevArtForCategory(bev.categoryId),
    alt: bev.name,
    status: bev.photoStatus,
  };
}

/** "Brand · Flavor", dropping "Original" and missing parts (design system `brandLine`). */
export function brandLine(bev: Pick<BevSummary, 'brand' | 'flavor'>): string {
  return [bev.brand, bev.flavor && bev.flavor !== 'Original' ? bev.flavor : null].filter(Boolean).join(' · ');
}

/**
 * The Want to Try bookmark: `primary` and filled once saved. Gives way under the finger like
 * IconButton (Press), and a press pops the bookmark like the heart (Change). Without `onPress` it
 * is inert, as before: no handler, no feedback, no pop.
 */
export function SaveButton({ saved, onPress }: { saved: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const pop = usePop();
  return (
    <FeedbackPressable
      onPress={
        onPress
          ? () => {
              pop.pop();
              onPress();
            }
          : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Saved to Want to Try' : 'Save to Want to Try'}
      // react-native-web drops accessibilityState.selected/checked for buttons; aria-pressed renders.
      {...({ 'aria-pressed': saved } as object)}
      style={TARGET_MIN}
    >
      <Animated.View style={pop.style} testID="save-pop">
        <Icon name="bookmark" size={28} strokeWidth={1.6} filled={saved} color={saved ? colors.primary : colors.text} />
      </Animated.View>
    </FeedbackPressable>
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

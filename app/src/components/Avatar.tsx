import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { initialsOf } from '@/lib/format';
import { radius, useTheme } from '@/theme';

export interface AvatarProps {
  name: string;
  src?: string;
  /** 32 (tab bar), 44 (people rows), 60 (feed posts), 100 (profile hero). */
  size?: 32 | 44 | 60 | 100;
  /** A 2pt `surface` outline, for overlapping stacks. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Initials sizes from the design system (bundle.css `.bv-avatar-*`). */
const INITIALS: Record<number, TextStyle> = {
  32: { fontSize: 12 },
  44: { fontSize: 16 },
  60: { fontSize: 22 },
  100: { fontSize: 40, fontWeight: '300' },
};
const RING = 2;

/** Circle with initials in `textSecondary` on `avatarFill`, or the person's photo. */
export function Avatar({ name, src, size = 44, ring = false, style }: AvatarProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, backgroundColor: colors.avatarFill, borderColor: colors.border },
        ring && { outlineWidth: RING, outlineStyle: 'solid', outlineColor: colors.surface },
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      {src ? (
        <Image source={{ uri: src }} style={styles.photo} contentFit="cover" recyclingKey={src} accessible={false} />
      ) : (
        <Text
          style={[styles.initials, INITIALS[size] ?? { fontSize: Math.round(size * 0.36) }, { color: colors.textSecondary }]}
          maxFontSizeMultiplier={1}
          numberOfLines={1}
        >
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  photo: { width: '100%', height: '100%' },
  initials: { fontWeight: '400', includeFontPadding: false },
});

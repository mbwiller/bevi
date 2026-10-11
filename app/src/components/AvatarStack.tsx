import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, radius, spacing, useTheme } from '@/theme';

import { Avatar, type AvatarProps } from './Avatar';

/** Who to draw: a name for the initials and accessible label, and an optional photo. */
export interface AvatarStackPerson {
  name: string;
  src?: string;
}

export interface AvatarStackProps {
  people: AvatarStackPerson[];
  size?: AvatarProps['size'];
  /** Avatars shown before the "+N" chip. */
  max?: number;
  /** How far each avatar tucks under the previous one, in pt. */
  overlap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Overlapping Avatars ("Friends who've had it"), with a "+N" chip past `max`. */
export function AvatarStack({ people, size = 32, max = 4, overlap = spacing.sm, style }: AvatarStackProps) {
  const { colors } = useTheme();
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={people.map((p) => p.name).join(', ')}
    >
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} src={p.src} size={size} ring style={i > 0 && { marginLeft: -overlap }} />
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.more,
            { height: size, minWidth: size, marginLeft: -overlap, backgroundColor: colors.input, outlineColor: colors.surface },
          ]}
        >
          <Text style={[styles.moreText, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            +{rest}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    outlineWidth: 2,
    outlineStyle: 'solid',
  },
  moreText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

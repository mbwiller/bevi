import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { size, spacing, type, useTheme } from '@/theme';

export interface SectionHeaderProps {
  /** Written in sentence case; `sectionCaps` renders it uppercase. */
  title: string;
  /** Link text ("See all") in `primary`. */
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** "FEATURED BEVS" caps label with an optional "See all" link in `primary`. */
export function SectionHeader({ title, action, onAction, style }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Text style={[type.sectionCaps, styles.title, { color: colors.text }]} role="heading" aria-level={2} numberOfLines={1}>
        {title}
      </Text>
      {action ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="link"
          // "See all featured bevs": the visible text first, then what it opens.
          accessibilityLabel={`${action} ${title.toLowerCase()}`}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={[type.sectionCaps, { color: colors.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: size.target,
    paddingHorizontal: spacing.gutter,
  },
  title: { flexShrink: 1 },
  link: { minHeight: size.target, justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});

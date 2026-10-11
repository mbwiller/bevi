import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { size, spacing, type, useTheme } from '@/theme';

import { TARGET_MIN } from './HitTarget';
import { Icon } from './Icon';

export interface SortToggleProps {
  /** The current sort: Score, Recent, Name, Predicted. */
  label?: string;
  /** Cycles the sort. */
  onPress?: () => void;
  /** Opens search within the list; `false` hides the icon. */
  onSearch?: (() => void) | false;
  style?: StyleProp<ViewStyle>;
}

/** The search icon's 44pt box hangs 10pt into the gutter so the glyph lines up with the edge (bundle.css). */
const SEARCH_OUTDENT = -10;

/** "↓↑ Score" text button in `primary`, with an optional search icon at the right edge of its row. */
export function SortToggle({ label = 'Score', onPress, onSearch, style }: SortToggleProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${label}`}
        style={({ pressed }) => [styles.sort, pressed && styles.pressed]}
      >
        <Icon name="arrow-up-down" size={16} strokeWidth={2.25} color={colors.primary} />
        <Text style={[type.heading, { color: colors.primary }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {onSearch !== false ? (
        <Pressable
          onPress={onSearch || undefined}
          accessibilityRole="button"
          accessibilityLabel="Search this list"
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <Icon name="search" size={22} strokeWidth={1.75} color={colors.primary} />
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
    paddingHorizontal: spacing.gutter,
  },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: size.target },
  search: { ...TARGET_MIN, marginRight: SEARCH_OUTDENT },
  pressed: { opacity: 0.6 },
});

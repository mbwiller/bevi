import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { size, type, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface ListScopeDropdownProps {
  /** "All" or the category's label. */
  label?: string;
  /** Opens the category Sheet. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Beli's "All ⌄": a 28pt bold label that opens a sheet to scope the list to one category. */
export function ListScopeDropdown({ label = 'All', onPress, style }: ListScopeDropdownProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, choose a category`}
      {...({ 'aria-haspopup': 'dialog' } as object)}
      style={({ pressed }) => [styles.scope, pressed && styles.pressed, style]}
    >
      <Text style={[type.displayDrop, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="chevron-down" size={22} strokeWidth={2.25} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scope: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: size.target },
  pressed: { opacity: 0.6 },
});

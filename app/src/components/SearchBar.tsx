import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { HitTarget } from './HitTarget';
import { Icon } from './Icon';

export interface SearchBarProps {
  /** Names what can be found ("Search a Bev, brand or flavor"); also the accessible name. */
  placeholder?: string;
  /** Controlled text. Leave undefined to let the bar hold its own. */
  value?: string;
  onChange?: (v: string) => void;
  /** filled: the grey 36pt bar (Feed). outlined: the 48pt field (Add Bev). */
  variant?: 'filled' | 'outlined';
  autoFocus?: boolean;
  /** Called after the clear button empties the field (onChange('') fires first). */
  onClear?: () => void;
  /** Return / the keyboard's Search key. */
  onSubmit?: (v: string) => void;
  /** The input's DOM id on web. */
  id?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT = { filled: 36, outlined: 48 } as const;
const CLEAR = 32;

/** Search input: `filled` (grey 36pt bar at the top of Feed) or `outlined` (48pt field on Add Bev). A clear button appears once there is text. */
export function SearchBar({
  placeholder = 'Search a Bev or a person',
  value,
  onChange,
  variant = 'filled',
  autoFocus,
  onClear,
  onSubmit,
  id,
  style,
}: SearchBarProps) {
  const { colors, elevation } = useTheme();
  const [own, setOwn] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const val = value ?? own;
  const outlined = variant === 'outlined';

  const change = (v: string) => {
    setOwn(v);
    onChange?.(v);
  };
  const clear = () => {
    change('');
    onClear?.();
    input.current?.focus();
  };

  return (
    // Tapping the bar's padding or icon focuses the input, as the design system's <label> wrapper does.
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      focusable={false}
      style={[
        styles.bar,
        outlined
          ? { height: HEIGHT.outlined, paddingLeft: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }
          : { height: HEIGHT.filled, paddingLeft: 10, backgroundColor: colors.input },
        focused && { boxShadow: elevation.focusRing },
        style,
      ]}
    >
      <Icon name="search" size={outlined ? 22 : 20} strokeWidth={2} color={colors.textSecondary} />
      <TextInput
        ref={input}
        id={id}
        value={val}
        onChangeText={change}
        onSubmitEditing={onSubmit ? (e) => onSubmit(e.nativeEvent.text) : undefined}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Web: a Search return key, no autocorrect or capitalisation. No inputMode="search": react-native-web
        // turns it into type="search", whose WebKit cancel button would double up with our clear button.
        enterKeyHint="search"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        style={[styles.input, { color: colors.text }]}
      />
      {val ? (
        <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
          <HitTarget height={CLEAR} width={CLEAR} />
          <Icon name="x" size={18} strokeWidth={2} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingRight: spacing.xs,
    borderRadius: radius.input,
  },
  // 17pt (bodyLarge) also keeps iOS Safari from zooming the page on focus (it zooms below 16px).
  input: { ...type.bodyLarge, flex: 1, minWidth: 0, alignSelf: 'stretch', padding: 0, borderWidth: 0, outlineWidth: 0 },
  clear: { width: CLEAR, height: CLEAR, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
});

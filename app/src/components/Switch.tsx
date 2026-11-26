import { Pressable, Switch as NativeSwitch, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { size, useTheme } from '@/theme';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Its accessible name: the label of the row it ends ("Likes"). */
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * An on/off switch for one setting (design system Switch): the platform's own switch, `primary`
 * when on and `borderStrong` when off, with a `surface` knob. It is announced as a switch, on or
 * off, and the knob moves, so its state is never colour alone; iOS's own switch follows Reduce
 * Motion itself.
 *
 * The visual is 31pt tall; its box is `size.target` tall. The space above and below it is a
 * press area of its own (hidden from assistive technology, a sibling rather than a parent so the
 * switch's own press is never counted twice), the way the design system's `::after` expander does.
 */
export function Switch({ checked = false, onChange, label, disabled = false, style }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, style]} testID="switch-box">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={disabled ? undefined : () => onChange?.(!checked)}
        accessible={false}
        importantForAccessibility="no"
        focusable={false}
        testID="switch-target"
      />
      <NativeSwitch
        value={checked}
        onValueChange={(on) => onChange?.(on)}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled }}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: size.target, justifyContent: 'center' },
});

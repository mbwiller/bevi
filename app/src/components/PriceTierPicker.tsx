import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { Pill } from './Pill';
import { priceTierText } from './PriceTier';

type Tier = 1 | 2 | 3 | 4;

export interface PriceTierPickerProps {
  /** Controlled tier, or null for none. Leave undefined to let the picker hold its own. */
  value?: Tier | null;
  /** "Not sure, estimate it" is on. */
  estimated?: boolean;
  /** Choosing "estimate" sends `(null, true)`, which maps to `priceTier: null, priceEstimated: true`. */
  onChange?: (tier: Tier | null, estimated: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

const TIERS: Tier[] = [1, 2, 3, 4];

/** Four tappable "$" cells plus "Not sure, estimate it" (create-Bev wizard, step 2). */
export function PriceTierPicker({ value, estimated = false, onChange, style }: PriceTierPickerProps) {
  const { colors } = useTheme();
  const [own, setOwn] = useState<{ tier: Tier | null; est: boolean }>({ tier: value ?? null, est: estimated });
  const cur = value !== undefined ? { tier: value, est: estimated } : own;
  const set = (tier: Tier | null, est: boolean) => {
    setOwn({ tier, est });
    onChange?.(tier, est);
  };
  return (
    <View style={[styles.picker, style]}>
      <View role="radiogroup" aria-label="Price tier" style={[styles.row, { borderColor: colors.borderStrong }]}>
        {TIERS.map((t, i) => {
          const on = cur.tier === t && !cur.est;
          return (
            <Pressable
              key={t}
              onPress={() => set(t, false)}
              role="radio"
              accessibilityRole="radio"
              accessibilityLabel={priceTierText(t)}
              accessibilityState={{ checked: on }}
              // react-native-web drops accessibilityState; it renders aria-checked.
              aria-checked={on}
              style={[
                styles.cell,
                i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border },
                on && { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[type.heading, styles.dollars, { color: on ? colors.onPrimary : colors.text }]}>{priceTierText(t)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pill active={cur.est} icon={cur.est ? 'check' : undefined} onPress={() => set(null, !cur.est)}>
        Not sure, estimate it
      </Pill>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { alignItems: 'flex-start', gap: spacing.md, alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  cell: { flex: 1, height: size.target, alignItems: 'center', justifyContent: 'center' },
  dollars: { fontVariant: ['tabular-nums'] },
});

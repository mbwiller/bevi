// SPIKE S2 (docs/find-bev-in-app-plan.md, Phase 0). Temporary: remove with the rest of this folder
// once the iPhone test is done.
//
// The Map tab as it ships, plus, for an internal bug reporter only (`bugs.canReport()`, the same gate
// as the Report a bug header action), a small "Camera test" entry that swaps the tab's content for
// the spike. Same URL, same tab shell, so the test runs where the real feature will. An ordinary
// account's Map tab is exactly as before.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCanReportBug } from '@/api/hooks';
import { PRESSED } from '@/components/HitTarget';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { FindBevScreen } from '../FindBevScreen';
import { SpikeScreen } from './SpikeScreen';

export const SPIKE_ENTRY_LABEL = 'Camera test';

export function MapTabWithSpike() {
  const { colors } = useTheme();
  const { data: canReport } = useCanReportBug({ enabled: true });
  const [open, setOpen] = useState(false);

  if (open && canReport === true) return <SpikeScreen onClose={() => setOpen(false)} />;
  return (
    <View style={styles.fill}>
      <FindBevScreen />
      {canReport === true ? (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={SPIKE_ENTRY_LABEL}
          style={({ pressed }) => [styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && PRESSED]}
        >
          <Text style={[type.caption, { color: colors.textSecondary }]}>{SPIKE_ENTRY_LABEL}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  entry: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    minHeight: size.target,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
});

import { StyleSheet, View } from 'react-native';

import { Pill } from '@/components/Pill';
import { spacing } from '@/theme';

import { SCOPE_LABELS } from './copy';
import type { PointsScope } from './pointsScope';

const SCOPES: readonly PointsScope[] = ['friends', 'everyone'];

/**
 * Friends | Everyone (design system ScreenPeople): two outlined Pills between "Ranked by points" and
 * the rows. The chosen one uses the Pill's active state, which also marks it pressed (`aria-pressed`)
 * for assistive tech. Pressing the chosen one does nothing.
 */
export function ScopePills({ value, onChange }: { value: PointsScope; onChange: (scope: PointsScope) => void }) {
  return (
    <View style={styles.row} testID="points-scope">
      {SCOPES.map((scope) => (
        <Pill
          key={scope}
          variant="outlined"
          active={scope === value}
          onPress={() => {
            if (scope !== value) onChange(scope);
          }}
        >
          {SCOPE_LABELS[scope]}
        </Pill>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
});

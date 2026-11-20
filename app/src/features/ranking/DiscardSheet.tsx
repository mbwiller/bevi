import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { spacing, type, useTheme } from '@/theme';

/** Closing mid-flow asks first (§6.9): nothing is saved until the last step. */
export function DiscardSheet({
  open,
  onDiscard,
  onKeep,
  onClosed,
}: {
  open: boolean;
  onDiscard: () => void;
  onKeep: () => void;
  /** The sheet has finished closing (`Sheet`'s `onClosed`). */
  onClosed?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet open={open} title="Discard this ranking?" onClose={onKeep} onClosed={onClosed}>
      <View style={styles.body}>
        <Text style={[type.body, styles.text, { color: colors.textSecondary }]}>Your answers so far won&apos;t be saved.</Text>
        <Button variant="primary" block onPress={onDiscard}>
          Discard
        </Button>
        <Button variant="outlined" block size="lg" onPress={onKeep}>
          Keep ranking
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  text: { textAlign: 'center' },
});

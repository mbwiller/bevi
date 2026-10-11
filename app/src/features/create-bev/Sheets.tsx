import type { CategoryId } from '@bevi/shared';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { SheetOption } from '@/features/lists/SheetOption';
import type { CategoryInfo } from '@/lib/categories';
import { spacing, type, useTheme } from '@/theme';

/** Category picker (§6.19): only the categories this person can see. */
export function CategorySheet({
  open,
  categories,
  value,
  onChoose,
  onClose,
}: {
  open: boolean;
  categories: readonly CategoryInfo[];
  value: CategoryId | null;
  onChoose: (id: CategoryId) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Category" snap={90} onClose={onClose}>
      <ScrollView>
        {categories.map((c) => (
          <SheetOption key={c.id} label={c.label} icon={c.icon} selected={c.id === value} onPress={() => onChoose(c.id)} />
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** Closing with something entered asks first. */
export function DiscardBevSheet({ open, onDiscard, onKeep }: { open: boolean; onDiscard: () => void; onKeep: () => void }) {
  const { colors } = useTheme();
  return (
    <Sheet open={open} title="Discard this Bev?" onClose={onKeep}>
      <View style={styles.body}>
        <Text style={[type.body, styles.text, { color: colors.textSecondary }]}>The photo and details you added won&apos;t be saved.</Text>
        <Button variant="primary" block onPress={onDiscard}>
          Discard
        </Button>
        <Button variant="outlined" block size="lg" onPress={onKeep}>
          Keep editing
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  text: { textAlign: 'center' },
});

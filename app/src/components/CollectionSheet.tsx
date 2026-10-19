import type { CategoryId, CategoryProgress } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryById } from '@/lib/categories';
import { formatTried, spokenTried } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';

import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { Sheet } from './Sheet';

/** bundle.css `.bv-collection-row { min-height: 64px }`: the 44pt target plus the bar under the label. */
const ROW_MIN = 64;

export interface CollectionSheetProps {
  open?: boolean;
  /** `stats.getCategoryProgress()`: already age-filtered, in category order. */
  rows: readonly CategoryProgress[];
  onClose?: () => void;
  /** A row scopes Bev'd to its category. */
  onSelect?: (categoryId: CategoryId) => void;
}

/**
 * "Your collection": every category the viewer can see, in catalog order (so a bar never jumps rows as
 * you rank), each with "9 of 40" and a 4pt bar. Empty categories are left out.
 */
export function CollectionSheet({ open = false, rows, onClose, onSelect }: CollectionSheetProps) {
  const { colors } = useTheme();
  const shown = rows.filter((r) => r.total > 0 && categoryById(r.categoryId));
  const ranked = shown.reduce((n, r) => n + r.ranked, 0);
  const total = shown.reduce((n, r) => n + r.total, 0);
  return (
    <Sheet open={open} title="Your collection" snap={90} onClose={onClose}>
      <Text style={[type.body, styles.sum, { color: colors.textSecondary }]} accessibilityLabel={spokenTried(ranked, total)}>
        {formatTried(ranked, total)}
      </Text>
      <View style={[styles.list, { borderTopColor: colors.border }]}>
        {shown.map((r) => {
          const cat = categoryById(r.categoryId);
          return (
            <Pressable
              key={r.categoryId}
              onPress={() => onSelect?.(r.categoryId)}
              accessibilityRole="button"
              accessibilityLabel={`${cat.label}, ${spokenTried(r.ranked, r.total)}. Show only ${cat.label}`}
              style={[styles.row, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            >
              <Icon name={cat.icon} size={24} strokeWidth={1.75} color={colors.text} />
              <View style={styles.text}>
                <View style={styles.top}>
                  <Text
                    style={[type.heading, styles.label, { color: colors.text }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
                  >
                    {cat.label}
                  </Text>
                  <Text style={[type.body, styles.count, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
                    {`${r.ranked} of ${r.total}`}
                  </Text>
                </View>
                <ProgressBar value={r.ranked / r.total} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sum: { textAlign: 'center', paddingHorizontal: spacing.gutter, paddingBottom: spacing.md, fontVariant: ['tabular-nums'] },
  list: { borderTopWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: ROW_MIN,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  text: { flex: 1, minWidth: 0, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  label: { flexShrink: 1, minWidth: 0 },
  count: { fontVariant: ['tabular-nums'] },
});

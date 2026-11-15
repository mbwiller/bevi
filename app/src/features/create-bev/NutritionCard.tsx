import type { NutritionPreview } from '@bevi/shared';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Wordmark } from '@/components/Wordmark';
import { radius, spacing, type, useTheme } from '@/theme';

const amount = (value: number | null, unit = '') => value === null ? 'Not listed' : `${Number(value.toFixed(2))}${unit}`;

export function NutritionCard({ nutrition, reveal = false }: { nutrition: NutritionPreview; reveal?: boolean }) {
  const { colors } = useTheme();
  const serving = nutrition.basis.startsWith('Per serving (') ? nutrition.basis.slice('Per serving ('.length, -1) : null;
  const rows = [
    { name: 'Total Fat', value: nutrition.fatGrams, unit: 'g' },
    { name: 'Sodium', value: nutrition.sodiumMg, unit: 'mg' },
    { name: 'Total Carbohydrate', value: nutrition.carbohydrateGrams, unit: 'g' },
    { name: 'Total Sugars', value: nutrition.sugarGrams, unit: 'g', indent: true },
    { name: 'Protein', value: nutrition.proteinGrams, unit: 'g' },
  ];
  return (
    <View style={styles.wrap}>
      <Text style={[type.heading, { color: colors.text }]}>{nutrition.productName}</Text>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
        <View style={[styles.masthead, { backgroundColor: colors.primary }]}>
          <View style={styles.brandline}>
            <Wordmark height={22} tone="mono" color={colors.onPrimary} />
            <Text style={[type.caption, { color: colors.onPrimary }]}>{reveal ? 'Captured' : 'Barcode match'}</Text>
          </View>
          <Text style={[styles.title, { color: colors.onPrimary }]} accessibilityRole="header">Nutrition Facts</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.serving}>
            <Text style={[styles.bold, { color: colors.primary }]}>{serving ? 'Serving size' : 'Nutrition basis'}</Text>
            <Text style={[styles.bold, styles.servingValue, { color: colors.primary }]}>{serving ?? nutrition.basis.replace(/^Per /, '')}</Text>
          </View>
          <View style={[styles.thickRule, { backgroundColor: colors.primary }]} />
          <Text style={[styles.amount, { color: colors.primary }]}>{serving ? 'Amount per serving' : nutrition.basis}</Text>
          <View style={styles.calories}>
            <Text style={[styles.calorieLabel, { color: colors.primary }]}>Calories</Text>
            <Text accessibilityLabel={`${amount(nutrition.calories)} calories`} style={[styles.calorieNumber, { color: colors.primary }]}>{amount(nutrition.calories)}</Text>
          </View>
          <View style={[styles.mediumRule, { backgroundColor: colors.primary }]} />
          {rows.map(({ name, value, unit, indent }, index) => (
            <View key={name} style={[styles.row, { borderTopColor: colors.borderStrong }, index === 0 && styles.firstRow, indent && styles.indented]}>
              <Text style={[styles.nutrient, { color: colors.text }]}>
                <Text style={!indent ? styles.bold : undefined}>{name}</Text>{' '}
                <Text>{amount(value, unit)}</Text>
              </Text>
            </View>
          ))}
          <View style={[styles.thickRule, { backgroundColor: colors.primary }]} />
          <Text style={[styles.footnote, { color: colors.textSecondary }]}>Values shown for the amount listed above. Missing values are not zero.</Text>
        </View>
      </View>
      <View style={styles.credit}>
        <Text style={[type.caption, styles.creditText, { color: colors.textSecondary }]}>Check against your package. Daily Values and other label details may not be available.</Text>
      </View>
      <Button variant="ghost" onPress={() => void Linking.openURL(nutrition.sourceUrl)} accessibilityLabel="View product on Open Food Facts">Open Food Facts · ODbL</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  panel: { borderWidth: 2, borderRadius: radius.photo, overflow: 'hidden' },
  masthead: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  brandline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  title: { ...type.displayDrop, marginTop: spacing.sm, fontSize: type.displayDrop.fontSize + spacing.sm, lineHeight: type.displayDrop.lineHeight + spacing.sm, fontWeight: '900', letterSpacing: -1 },
  bold: { ...type.body, fontWeight: '700' },
  serving: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.xs, paddingVertical: spacing.sm },
  servingValue: { textAlign: 'right', flexShrink: 1 },
  thickRule: { height: spacing.sm },
  mediumRule: { height: spacing.xs },
  amount: { ...type.caption, fontWeight: '700', paddingTop: spacing.xs },
  calories: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, paddingBottom: spacing.xs, flexWrap: 'wrap' },
  calorieLabel: { ...type.displayDrop, fontWeight: '900' },
  calorieNumber: { ...type.displayDrop, fontSize: type.displayDrop.fontSize + spacing.md, lineHeight: type.displayDrop.lineHeight + spacing.md, fontWeight: '900', fontVariant: ['tabular-nums'] },
  row: { borderTopWidth: 1, paddingVertical: spacing.xs },
  firstRow: { borderTopWidth: 0 },
  indented: { marginLeft: spacing.lg },
  nutrient: { ...type.body, fontVariant: ['tabular-nums'] },
  footnote: { ...type.caption, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  credit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  creditText: { flex: 1 },
});

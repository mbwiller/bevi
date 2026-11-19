import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, type, useTheme } from '@/theme';
import { NutritionScan } from './NutritionScan';

/** Standalone preview, enabled explicitly for the prototype server. No session or Bev writes. */
export function NutritionDemo() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.surface }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">Scan a Bev</Text>
        <Text style={[type.bodyLarge, { color: colors.textSecondary }]}>Try the barcode scanner and nutrition reveal.</Text>
        <NutritionScan demoBarcode="5449000000996" />
        <Text style={[type.body, { color: colors.textSecondary }]}>Try a sample to replay the reveal with Coca-Cola nutrition, or scan a drink of your own.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.gutter, gap: spacing.xl, maxWidth: 560, width: '100%', alignSelf: 'center' },
});

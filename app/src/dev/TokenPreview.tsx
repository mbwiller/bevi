import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/Wordmark';
import { radius, size, spacing, type, useTheme, type ColorName } from '@/theme';

const SWATCHES: ColorName[] = [
  'primary', 'primaryTint', 'fizz', 'scoreHigh', 'scoreMid', 'scoreLow',
  'text', 'textSecondary', 'border', 'borderStrong', 'input', 'surface',
];
const TYPE_STYLES = Object.keys(type) as (keyof typeof type)[];

/** Dev-only check that tokens render in both appearances. Grows into the ComponentGallery (task 1.2). */
export function TokenPreview() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.header}>
        <Wordmark height={28} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]}>Colours</Text>
        <View style={styles.swatches}>
          {SWATCHES.map((name) => (
            <View key={name} style={styles.swatch}>
              <View style={[styles.chip, { backgroundColor: colors[name], borderColor: colors.border }]} />
              <Text style={[type.caption, { color: colors.textSecondary }]}>{name}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]}>Type</Text>
        {TYPE_STYLES.map((name) => (
          <Text key={name} style={[type[name], { color: colors.text }]}>
            {name}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { height: size.header, justifyContent: 'center', paddingHorizontal: spacing.gutter },
  content: { padding: spacing.gutter, gap: spacing.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatch: { width: 96, gap: spacing.xs },
  chip: { height: 40, borderRadius: radius.input, borderWidth: StyleSheet.hairlineWidth },
});

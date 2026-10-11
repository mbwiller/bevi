import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pill } from '@/components/Pill';
import { Wordmark } from '@/components/Wordmark';
import { ColorSchemeOverride, size, spacing, type, useTheme, type ColorScheme } from '@/theme';

import { controls } from './gallery/Controls';
import { primitives } from './gallery/Primitives';
import type { GallerySection } from './gallery/types';

/** Every component group, in order. A PR that adds components adds one import and one entry here. */
export const SECTIONS: GallerySection[] = [primitives, controls];

const SCHEMES: { id: ColorScheme | null; label: string }[] = [
  { id: null, label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Dev screen: every design-system component in every state, in light or dark. */
export function ComponentGallery() {
  const [scheme, setScheme] = useState<ColorScheme | null>(null);
  return (
    <ColorSchemeOverride scheme={scheme}>
      <GalleryBody scheme={scheme} onScheme={setScheme} />
    </ColorSchemeOverride>
  );
}

function GalleryBody({ scheme, onScheme }: { scheme: ColorScheme | null; onScheme: (s: ColorScheme | null) => void }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Wordmark height={28} />
        <View style={styles.toggle}>
          {SCHEMES.map((s) => (
            <Pill key={s.label} active={scheme === s.id} onPress={() => onScheme(s.id)} accessibilityLabel={`${s.label} appearance`}>
              {s.label}
            </Pill>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map(({ id, title, Component }) => (
          <View key={id} style={styles.section}>
            <Text style={[type.sectionCaps, { color: colors.textSecondary }]} accessibilityRole="header">
              {title}
            </Text>
            <Component />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: size.header,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  toggle: { flexDirection: 'row', gap: spacing.sm },
  content: { padding: spacing.gutter },
  section: { paddingBottom: spacing.xxl },
});

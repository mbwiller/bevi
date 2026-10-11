import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/Wordmark';
import { spacing, type, useTheme } from '@/theme';

const WORDMARK_HEIGHT = 48;
/** The form column stays phone-width on a wide browser window. */
const FORM_MAX = 420;

/** Sign in and sign up: the wordmark and tagline in the top third, then the form (§6.1). */
export function AuthScreen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <View style={styles.brand}>
            <Wordmark height={WORDMARK_HEIGHT} />
            <Text style={[type.body, { color: colors.textSecondary }]}>Rank every drink you've ever had</Text>
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A one-line form error under the fields (announced politely). */
export function FormError({ children }: { children?: string | null }) {
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.body, { color: colors.scoreLow }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.gutter },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', gap: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.sm, paddingTop: '18%', paddingBottom: spacing.xxl },
});

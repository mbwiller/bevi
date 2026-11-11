import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HitTarget, PRESSED } from '@/components/HitTarget';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { radius, spacing, type, useTheme } from '@/theme';

import { FindArt } from './FindArt';
import { BEV_MAPS_URL } from './links';

export const FIND_BEV_TITLE = 'Find Bev';
export const FIND_BEV_BODY = 'Walk to the closest open place to grab a drink.';
export const FIND_BEV_CAPTION = 'Opens Bev Maps';

/** The primary Button's `lg` height (Button.tsx); the link below is drawn as that Button. */
const BUTTON_LG = 52;
/** `.mk-find-copy { max-width: 280px }`: keeps the line under the title to two short lines. */
const COPY_MAX = 280;

/**
 * The Map tab (the 2026-11 navigation redesign; the old venue map is parked): the round minimap,
 * "Find Bev", one line on what it does, and a primary "Find Bev" button that opens Bev Maps in a
 * new browser tab. On the web the button is a real anchor (`target="_blank"`), so the browser's own
 * link handling applies; elsewhere the OS opens the URL.
 */
export function FindBevScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Map" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.art}>
          <FindArt />
        </View>
        <View style={styles.copy}>
          <Text style={[type.displayDrop, styles.center, { color: colors.text }]} role="heading" aria-level={2}>
            {FIND_BEV_TITLE}
          </Text>
          <Text style={[type.bodyLarge, styles.center, { color: colors.textSecondary }]}>{FIND_BEV_BODY}</Text>
        </View>
        <View style={styles.cta}>
          <Pressable
            // On the web a real anchor (react-native-web renders `href` as <a>), as VenueSheet's website link.
            {...(Platform.OS === 'web'
              ? ({ href: BEV_MAPS_URL, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as object)
              : { onPress: () => void Linking.openURL(BEV_MAPS_URL) })}
            accessibilityRole="link"
            accessibilityLabel={FIND_BEV_TITLE}
            style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && PRESSED]}
          >
            <HitTarget height={BUTTON_LG} />
            <Icon name="navigation" size={22} strokeWidth={2} color={colors.onPrimary} />
            <Text style={[type.heading, styles.buttonLabel, { color: colors.onPrimary }]} numberOfLines={1}>
              {FIND_BEV_TITLE}
            </Text>
          </Pressable>
          <Text style={[type.caption, styles.center, { color: colors.textSecondary }]}>{FIND_BEV_CAPTION}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// The approved mock's `.mk-find*`.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  art: { marginBottom: spacing.sm },
  copy: { gap: spacing.xs, maxWidth: COPY_MAX, alignItems: 'center' },
  center: { textAlign: 'center' },
  cta: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
  // Button variant="primary" block: 52pt, `radius.input`, `spacing.xxl` sides, an `sm` gap, a 22pt icon, the label in heading 600.
  button: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: BUTTON_LG,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.input,
  },
  buttonLabel: { fontWeight: '600' },
});

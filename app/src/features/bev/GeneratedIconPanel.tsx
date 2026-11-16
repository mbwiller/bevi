import type { BevIcon } from '@bevi/shared';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';
import { radius, size, spacing, type } from '@/theme';

/** A small, explicit preview of the AI illustration; the uploaded photo remains the Bev's main image. */
export function GeneratedIconPanel({ name, icon }: { name: string; icon: BevIcon | null | undefined }) {
  const { colors } = useTheme();
  if (!icon || icon.iconStatus === 'none') return null;

  const completed = icon.iconStatus === 'completed' && !!icon.generatedIconUrl;
  const title = completed ? 'Your illustration is ready' : 'Your illustration';
  const message = completed
    ? 'Made from the photo you added.'
    : icon.iconStatus === 'failed'
      ? 'We couldn’t create an illustration this time. Your photo is still here.'
      : 'We’re creating an illustration from your photo. It will appear here when it’s ready.';

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="generated-icon-panel">
      <View style={styles.copy}>
        <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {message}
        </Text>
      </View>
      {completed ? (
        <Image
          source={{ uri: icon.generatedIconUrl! }}
          style={[styles.image, { backgroundColor: colors.input, borderRadius: radius.input }]}
          contentFit="contain"
          recyclingKey={icon.generatedIconUrl!}
          accessibilityRole="image"
          accessibilityLabel={`${name} generated illustration`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: { flex: 1, gap: spacing.xs },
  image: { width: size.bevImageStrip, height: size.bevImageStrip },
});

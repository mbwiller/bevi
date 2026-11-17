import type { BevIcon } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { useTheme } from '@/theme';
import { radius, spacing, type } from '@/theme';

const PREVIEW_SIZE = 96;
const PREVIEW_PADDING = Math.round(PREVIEW_SIZE * 0.08);
const PREVIEW_CONTENT_SIZE = PREVIEW_SIZE - PREVIEW_PADDING * 2;

/** The generated illustration; the uploaded photo remains the Bev's main image. */
export function GeneratedIconPanel({
  name,
  brand,
  icon,
  isOwner,
}: {
  name: string;
  brand: string | null;
  icon: BevIcon | null | undefined;
  isOwner: boolean;
}) {
  const { colors } = useTheme();
  if (!icon) return null;

  const completed = icon.iconStatus === 'completed' && !!icon.generatedIconUrl;
  const active = icon.iconStatus === 'pending' || icon.iconStatus === 'processing';
  const failed = icon.iconStatus === 'failed';
  // Only the person who added the Bev sees job state. Everyone can see the finished illustration.
  if (!completed && (!isOwner || (!active && !failed))) return null;

  const title = completed
    ? isOwner
      ? 'Your illustration is ready'
      : 'Illustration'
    : failed
      ? 'Your illustration couldn’t be created'
      : icon.iconStatus === 'processing'
        ? 'Finishing your illustration'
        : 'Creating your illustration';
  const message = completed
    ? isOwner
      ? 'Made from the photo you added.'
      : 'A Bevi illustration for this drink.'
    : failed
      ? 'Your photo is still here. You can keep using this Bev without an illustration.'
      : 'It’ll appear here when it’s ready. Your original photo stays above.';
  const labelBand = completed ? icon.labelBand : null;
  const wordmark = brand?.trim() || name;
  const showWordmark = !!labelBand && labelBand.height * PREVIEW_CONTENT_SIZE >= type.tabBar.lineHeight;

  return (
    <View style={[styles.card, { borderColor: colors.border }]} testID="generated-icon-panel">
      <View
        style={styles.copy}
        accessibilityLiveRegion="polite"
        {...({ 'aria-live': 'polite' } as object)}
      >
        <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.textSecondary }]}>{message}</Text>
      </View>
      <View style={styles.preview}>
        <BevImage
          src={completed ? icon.generatedIconUrl! : undefined}
          alt={`${name} generated illustration`}
          size={PREVIEW_SIZE}
          status={active ? 'processing' : 'ready'}
          processingLabel="illustration generation"
        />
        {completed && showWordmark ? (
          <Text
            accessible={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[
              styles.wordmark,
              {
                left: `${((PREVIEW_PADDING + labelBand.x * PREVIEW_CONTENT_SIZE) / PREVIEW_SIZE) * 100}%`,
                top: `${((PREVIEW_PADDING + labelBand.y * PREVIEW_CONTENT_SIZE) / PREVIEW_SIZE) * 100}%`,
                width: `${(labelBand.width * PREVIEW_CONTENT_SIZE / PREVIEW_SIZE) * 100}%`,
                height: `${(labelBand.height * PREVIEW_CONTENT_SIZE / PREVIEW_SIZE) * 100}%`,
                color: labelBand.dark ? colors.onDeep : colors.text,
              },
            ]}
          >
            {wordmark}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, position: 'relative' },
  wordmark: {
    position: 'absolute',
    justifyContent: 'center',
    textAlign: 'center',
    textAlignVertical: 'center',
    ...type.tabBar,
    fontWeight: '700',
  },
});

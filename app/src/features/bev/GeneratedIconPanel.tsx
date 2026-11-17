import type { BevIcon } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { radius, spacing, type, useTheme } from '@/theme';

const PREVIEW_SIZE = 96;
const PREVIEW_PADDING = Math.round(PREVIEW_SIZE * 0.08);
const PREVIEW_CONTENT_SIZE = PREVIEW_SIZE - PREVIEW_PADDING * 2;

/**
 * Whether a creator may see their illustration's job state at all.
 *
 * It is `false` on purpose, and it is the counterpart of the worker's own
 * `ICON_GENERATION_ENABLED` default (`docs/icon-worker-operations.md`): while
 * generation is off every photo-backed Bev is enqueued and nothing ever claims
 * the job, so `pending` is not "shortly" -- it is forever, and any copy about
 * work in progress is a promise the rollout plan forbids keeping. A finished
 * illustration still shows (see `showGeneratedIcon`); none can exist until the
 * worker runs, so that path is inert rather than wrong.
 *
 * Flip this to `true` in the same release that sets `ICON_GENERATION_ENABLED`,
 * after the real-photo benchmark and visual review in
 * `docs/icon-quality-evaluation.md`.
 */
export const ICON_JOB_STATE_VISIBLE = false;

/**
 * Does this Bev's detail screen show the panel? The screen needs the answer for
 * its own spacing, so it lives here rather than being spelled out twice.
 *
 * A finished illustration is for everyone. Job state -- queued, running,
 * failed -- is the creator's business only, and only once generation is live.
 */
export function showGeneratedIcon(icon: BevIcon | null | undefined, isOwner: boolean): boolean {
  if (!icon) return false;
  if (icon.iconStatus === 'completed') return !!icon.generatedIconUrl;
  if (!isOwner || !ICON_JOB_STATE_VISIBLE) return false;
  return icon.iconStatus === 'pending' || icon.iconStatus === 'processing' || icon.iconStatus === 'failed';
}

/**
 * What the panel says about each state. Separate from the component, and tested
 * separately, because this copy is the feature's promise to the person who added
 * the photo: none of it may commit to an illustration arriving. The queue is
 * drained one job a minute, so even with generation on "it'll appear when it's
 * ready" could mean hours -- and with generation off it would never be true.
 */
export function generatedIconCopy(icon: BevIcon, isOwner: boolean): { title: string; message: string } {
  switch (icon.iconStatus) {
    case 'completed':
      return isOwner
        ? { title: 'Your illustration is ready', message: 'Made from the photo you added.' }
        : { title: 'Illustration', message: 'A Bevi illustration for this drink.' };
    case 'failed':
      return {
        title: 'Your illustration couldn’t be created',
        message: 'Your photo is still here. You can keep using this Bev without an illustration.',
      };
    case 'processing':
      return { title: 'Making your illustration', message: WAITING_MESSAGE };
    default:
      return { title: 'Illustration queued', message: WAITING_MESSAGE };
  }
}

const WAITING_MESSAGE = 'We’ll try to draw one from your photo. Your original photo stays above either way.';

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
  // Presentation only: whether job state may be shown at all is the screen's call,
  // through `showGeneratedIcon`. What is enforced here is who the copy is about.
  if (!icon || icon.iconStatus === 'none') return null;
  const finished = icon.iconStatus === 'completed' && !!icon.generatedIconUrl;
  if (!finished && (!isOwner || icon.iconStatus === 'completed')) return null;

  const completed = icon.iconStatus === 'completed';
  const active = icon.iconStatus === 'pending' || icon.iconStatus === 'processing';
  const { title, message } = generatedIconCopy(icon, isOwner);

  // Unfinished work borrows the authored catalogue icon the server picked, which is
  // the point of `fallbackIconUrl`: a real Bevi drink rather than a grey glyph.
  const src = completed ? icon.generatedIconUrl ?? undefined : icon.fallbackIconUrl ?? undefined;
  const labelBand = completed ? icon.labelBand : null;
  const wordmark = brand?.trim() || name;
  // The band in preview pixels. Below one line of `tabBar` there is no room to set
  // the name inside it, so the tile shows the illustration alone.
  const bandHeight = labelBand ? labelBand.height * PREVIEW_CONTENT_SIZE : 0;
  const showWordmark = !!labelBand && bandHeight >= type.tabBar.lineHeight;

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
          src={src}
          alt={`${name} generated illustration`}
          size={PREVIEW_SIZE}
          status={active ? 'processing' : 'ready'}
          processingLabel="illustration generation"
        />
        {showWordmark && labelBand ? (
          <Text
            accessible={false}
            numberOfLines={1}
            style={[
              styles.wordmark,
              {
                left: `${((PREVIEW_PADDING + labelBand.x * PREVIEW_CONTENT_SIZE) / PREVIEW_SIZE) * 100}%`,
                top: `${((PREVIEW_PADDING + labelBand.y * PREVIEW_CONTENT_SIZE) / PREVIEW_SIZE) * 100}%`,
                width: `${((labelBand.width * PREVIEW_CONTENT_SIZE) / PREVIEW_SIZE) * 100}%`,
                // One line centred in the band by its own leading: react-native-web
                // ignores `textAlignVertical`, so the height has to do the centring.
                height: bandHeight,
                lineHeight: bandHeight,
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
    textAlign: 'center',
    ...type.tabBar,
    fontWeight: '700',
  },
});

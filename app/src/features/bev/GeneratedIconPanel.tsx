import type { BevIcon } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

/**
 * Whether a creator may see their illustration's job state at all.
 *
 * It is `false` on purpose, and it is the counterpart of the worker's own
 * `ICON_GENERATION_ENABLED` default (`docs/icon-worker-operations.md`): while
 * generation is off every photo-backed Bev is enqueued and nothing ever claims
 * the job, so `pending` is not "shortly" -- it is forever, and any copy about
 * work in progress is a promise the rollout plan forbids keeping.
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
 * A FINISHED illustration is not in here at all: it arrives as the Bev's image
 * through `BevSummary.iconUrl`, drawn by `bevImageProps` wherever any other
 * icon is drawn, so saying so a second time on this one screen would be the
 * only place on Bevi that treats a created icon as a special kind of thing.
 * What is left is job state -- queued, running, failed -- which is the
 * creator's business only, and only once generation is live.
 */
export function showGeneratedIcon(icon: BevIcon | null | undefined, isOwner: boolean): boolean {
  if (!icon || !isOwner || !ICON_JOB_STATE_VISIBLE) return false;
  return icon.iconStatus === 'pending' || icon.iconStatus === 'processing' || icon.iconStatus === 'failed';
}

/**
 * What the panel says about each state. Separate from the component, and tested
 * separately, because this copy is the feature's promise to the person who added
 * the photo: none of it may commit to an illustration arriving. The queue is
 * drained one job a minute, so even with generation on "it'll appear when it's
 * ready" could mean hours -- and with generation off it would never be true.
 *
 * There is no `completed` copy: a finished illustration speaks for itself, as
 * the Bev's image.
 */
export function generatedIconCopy(icon: BevIcon): { title: string; message: string } {
  switch (icon.iconStatus) {
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

const WAITING_MESSAGE = 'We’ll try to draw one from your photo. Your photo stays the Bev’s image either way.';

/**
 * A line for the creator about an illustration that is queued, running or
 * failed. Nothing is drawn here: when one exists it is the Bev's image.
 */
export function GeneratedIconPanel({ icon, isOwner }: { icon: BevIcon | null | undefined; isOwner: boolean }) {
  const { colors } = useTheme();
  // Presentation only: whether job state may be shown at all is the screen's call,
  // through `showGeneratedIcon`. What is enforced here is who the copy is about.
  if (!icon || !isOwner) return null;
  if (icon.iconStatus === 'none' || icon.iconStatus === 'completed') return null;

  const { title, message } = generatedIconCopy(icon);

  return (
    <View
      style={[styles.card, { borderColor: colors.border }]}
      testID="generated-icon-panel"
      accessibilityLiveRegion="polite"
      {...({ 'aria-live': 'polite' } as object)}
    >
      <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.textSecondary }]}>{message}</Text>
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
    gap: spacing.xs,
  },
});

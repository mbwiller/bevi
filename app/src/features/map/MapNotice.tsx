import { StyleSheet, Text, View } from 'react-native';

import { Pill } from '@/components/Pill';
import { errorCopy } from '@/lib/errorCopy';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

export const NO_SPOTS = 'No spots here yet';

export type Notice = { kind: 'error'; error: unknown } | { kind: 'empty' } | null;

/**
 * What the map says about its pins, if anything. The map itself is the content, so loading shows
 * nothing over it (the previous pins stay up while the next viewport loads) and a failure is a
 * small notice rather than an ErrorState covering the streets.
 */
export function noticeFor(q: { isError: boolean; error: unknown; data: readonly unknown[] | undefined; isFetching: boolean; isPlaceholderData: boolean }): Notice {
  if (q.isError) return { kind: 'error', error: q.error };
  if (q.data && q.data.length === 0 && !q.isFetching && !q.isPlaceholderData) return { kind: 'empty' };
  return null;
}

/** A floating line at the top of the map: the error's title with Retry, or that there is nothing in view. */
export function MapNotice({ notice, onRetry }: { notice: Exclude<Notice, null>; onRetry: () => void }) {
  const { colors } = useTheme();
  const copy = notice.kind === 'error' ? errorCopy(notice.error) : null;
  return (
    <View
      testID="map-notice"
      accessibilityRole={copy ? 'alert' : undefined}
      aria-live="polite"
      style={[
        styles.notice,
        { backgroundColor: colors.surface, borderColor: colors.border, paddingRight: copy?.retry ? spacing.xs : spacing.lg },
      ]}
    >
      <Text style={[type.caption, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {copy ? copy.title : NO_SPOTS}
      </Text>
      {copy?.retry ? (
        <Pill variant="outlined" icon="refresh-cw" onPress={onRetry}>
          Retry
        </Pill>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
});

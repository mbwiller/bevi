import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { REPORT_UI, useLayer } from './ReportLayer';
import { hasFailed, pressReportButton, useReport } from './store';

/**
 * The reporter's one entry: a plain round button floating at the bottom-right of the column, above
 * the tab bar, on every signed-in screen. Press it to open the note (a new empty one when there is
 * none); press it again to set the note aside. While steps are being recorded it is the Stop
 * control, with a count of the steps beside it. It never moves and never animates: its pressed
 * state is the app's ordinary instant dim, and its badges are static.
 */

/** The round button's size: the 44pt target itself. */
export const BUTTON_SIZE = size.target;
/** Clear of a tab bar's height above the safe area. */
const TAB_BAR_CLEARANCE = 76;
/** The engine caps a recording at this many steps. */
export const STEP_LIMIT = 30;
const STOP = 14;

/** How far the button's bottom sits above the column's: above the tab bar, and above the note when it is open. */
export function buttonBottom(insetBottom: number, panelHeight: number): number {
  return Math.max(insetBottom + TAB_BAR_CLEARANCE + spacing.sm, panelHeight + spacing.sm);
}

export function ReportButton({ toPlace }: { toPlace: number }) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const layer = useLayer();
  const panelHeight = useReport((s) => (s.panel === 'open' && s.draft && s.sheet === null && !s.recording ? s.panelHeight : 0));
  const aside = useReport((s) => s.draft !== null && s.panel === 'closed' && !s.recording);
  const failed = useReport(hasFailed);
  const selecting = useReport((s) => s.selecting);
  const recording = useReport((s) => s.recording);

  if (selecting) return null;
  const bottom = Math.min(buttonBottom(insets.bottom, panelHeight), Math.max(0, layer.height - insets.top - BUTTON_SIZE));

  if (recording) {
    const count = recording.steps.length;
    return (
      <View style={[styles.row, { bottom }]} pointerEvents="box-none" {...REPORT_UI}>
        <View style={styles.status}>
          <View
            style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border, boxShadow: elevation.floating }]}
            accessibilityLiveRegion="polite"
          >
            <Text style={[type.caption, styles.pillText, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
              {`Recording · ${count} ${count === 1 ? 'step' : 'steps'}`}
            </Text>
          </View>
          {count >= STEP_LIMIT ? (
            <Text style={[type.caption, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
              {`${STEP_LIMIT} steps is the limit`}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={pressReportButton}
          accessibilityRole="button"
          accessibilityLabel="Stop recording steps"
          testID="report-button"
          style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, borderColor: colors.borderStrong, boxShadow: elevation.floating }, pressed && PRESSED]}
        >
          <View style={[styles.stop, { backgroundColor: colors.primary }]} testID="report-button-stop" />
        </Pressable>
      </View>
    );
  }

  const states = [aside ? 'Note set aside' : null, toPlace > 0 ? `${toPlace} to place` : null, failed ? "A report didn't send" : null].filter(
    Boolean,
  );

  return (
    <View style={[styles.row, { bottom }]} pointerEvents="box-none" {...REPORT_UI}>
      <Pressable
        onPress={pressReportButton}
        accessibilityRole="button"
        accessibilityLabel="Report"
        accessibilityHint="Opens the bug report note"
        accessibilityValue={states.length ? { text: states.join(', ') } : undefined}
        testID="report-button"
        style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, borderColor: colors.borderStrong, boxShadow: elevation.floating }, pressed && PRESSED]}
      >
        <Icon name="triangle-alert" size={22} strokeWidth={2} color={colors.primary} />
        {toPlace > 0 ? (
          <View style={[styles.count, { backgroundColor: colors.primary, borderColor: colors.surface }]} pointerEvents="none">
            <Text style={[styles.countText, { color: colors.onPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
              {toPlace > 9 ? '9+' : String(toPlace)}
            </Text>
          </View>
        ) : aside ? (
          <View style={[styles.dot, styles.topRight, { backgroundColor: colors.primary, borderColor: colors.surface }]} pointerEvents="none" testID="report-button-aside" />
        ) : null}
        {failed ? (
          <View style={[styles.dot, styles.topLeft, { backgroundColor: colors.badgeRed, borderColor: colors.surface }]} pointerEvents="none" testID="report-button-failed" />
        ) : null}
      </Pressable>
    </View>
  );
}

const DOT = 12;
const COUNT = 18;

const styles = StyleSheet.create({
  row: { position: 'absolute', right: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  status: { alignItems: 'flex-end', gap: spacing.xs },
  pill: { height: size.pill, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.pill },
  pillText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { width: STOP, height: STOP },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: radius.pill, borderWidth: 2 },
  topRight: { top: -spacing.xs / 2, right: -spacing.xs / 2 },
  topLeft: { top: -spacing.xs / 2, left: -spacing.xs / 2 },
  count: {
    position: 'absolute',
    top: -spacing.xs,
    right: -spacing.xs,
    minWidth: COUNT,
    height: COUNT,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { ...type.tabBar, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

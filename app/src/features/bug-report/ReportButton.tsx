import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { MAX_STEPS } from './limits';
import { REPORT_UI, useLayer } from './ReportLayer';
import { hasFailed, pressReportButton, useReport } from './store';

/**
 * The reporter's one entry: a plain round button floating at the bottom-right of the column, above
 * the tab bar, on every signed-in screen. Press it to open the note (a new empty one when there is
 * none); press it again to set the note aside. While steps are being recorded it is the Stop
 * control, with a count of the steps beside it. Its triangle is an outline until a note exists
 * and filled for as long as one does, open or set aside. It never moves and never animates: its
 * pressed state is the app's ordinary instant dim, and its badges are static.
 *
 * While the note is open with the keyboard up it isn't drawn: the note may then reach the top of
 * the screen, which leaves no place above it, and it used to land on the text being typed (T-21).
 * The note's own chevron sets it aside meanwhile.
 */

/** The round button's size: the 44pt target itself. */
export const BUTTON_SIZE = size.target;
/** Clear of a tab bar's height above the safe area. */
const TAB_BAR_CLEARANCE = 76;
const STOP = 14;
/** The triangle's size, outlined or filled. */
const GLYPH = 22;

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
  // A note exists, open or set aside: the triangle is filled for as long as it does.
  const inProgress = useReport((s) => s.draft !== null);
  const failed = useReport(hasFailed);
  const selecting = useReport((s) => s.selecting);
  const recording = useReport((s) => s.recording);
  const keyboard = useKeyboardInset();

  if (selecting) return null;
  if (panelHeight > 0 && keyboard > 0) return null;
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
          {count >= MAX_STEPS ? (
            <Text style={[type.caption, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
              {`${MAX_STEPS} steps is the limit`}
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

  const states = [inProgress && !aside ? 'Note in progress' : null, aside ? 'Note set aside' : null, toPlace > 0 ? `${toPlace} to place` : null, failed ? "A report didn't send" : null].filter(
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
        {inProgress ? (
          <FilledAlert size={GLYPH} fill={colors.primary} mark={colors.onPrimary} />
        ) : (
          <Icon name="triangle-alert" size={GLYPH} strokeWidth={2} color={colors.primary} />
        )}
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

/**
 * The `triangle-alert` glyph with its triangle filled, for a note in progress. `Icon`'s own fill
 * paints every path one colour, which would bury the exclamation mark, so the same three Lucide
 * paths are drawn here with the mark in a second colour.
 */
function FilledAlert({ size: side, fill, mark }: { size: number; fill: string; mark: string }) {
  return (
    <Svg width={side} height={side} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" testID="report-button-filled">
      <Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" fill={fill} stroke={fill} />
      <Path d="M12 9v4" stroke={mark} />
      <Path d="M12 17h.01" stroke={mark} />
    </Svg>
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

import { StyleSheet, Text, View } from 'react-native';

import { fade } from '@/lib/color';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

import { currentLevel } from './model';
import { REPORT_UI, useLayer } from './ReportLayer';
import { selectedMark, useReport } from './store';
import type { PickLevel } from './types';

/** The label chip's height: one caption line and its padding. */
const CHIP_H = type.caption.lineHeight + spacing.xs * 2;
const CHIP_GAP = spacing.xs;
const CHIP_MAX = 240;

/**
 * The outline on the app: the component under the pointer in select mode, else (while the note
 * is open) the selected mark at its chosen level, when its screen is the one on show. A 2pt
 * `primary` box with a faint `primary` fill, and its name in a chip above it (below when there is
 * no room above). It never takes a touch.
 */
export function Highlight() {
  const picking = useReport((s) => s.picking?.levels[0]);
  const selected = useReport((s) => {
    if (s.panel !== 'open' || s.sheet || s.recording) return undefined;
    const mark = selectedMark(s);
    return mark && mark.visit === s.nav.visit ? currentLevel(mark) : undefined;
  });
  const level = picking ?? selected;
  if (!level) return null;
  return <Outline level={level} />;
}

function Outline({ level }: { level: PickLevel }) {
  const { colors } = useTheme();
  const layer = useLayer();
  const origin = layer.origin();
  const box = { x: level.box.x - origin.x, y: level.box.y - origin.y, width: level.box.width, height: level.box.height };
  const above = box.y - CHIP_H - CHIP_GAP >= 0;
  const chipTop = above ? box.y - CHIP_H - CHIP_GAP : Math.min(box.y + box.height + CHIP_GAP, layer.height - CHIP_H);
  const chipLeft = Math.max(spacing.xs, Math.min(box.x, layer.width - CHIP_MAX - spacing.xs));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...REPORT_UI} testID="report-highlight">
      <View
        style={[
          styles.box,
          {
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            borderColor: colors.primary,
            backgroundColor: fade(colors.primary, 0.08),
          },
        ]}
      />
      <View style={[styles.chip, { top: chipTop, left: chipLeft, backgroundColor: colors.primary }]}>
        <Text
          style={[type.caption, styles.chipText, { color: colors.onPrimary }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          accessibilityLiveRegion="polite"
        >
          {level.title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 2, borderRadius: radius.input },
  chip: {
    position: 'absolute',
    maxWidth: CHIP_MAX,
    height: CHIP_H,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.button,
  },
  chipText: { fontWeight: '600' },
});

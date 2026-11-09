import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { HitTarget, PRESSED } from './HitTarget';
import { Icon, type IconName } from './Icon';

export type MapMode = 'map' | 'list';

export interface MapControlsProps {
  /** Full screen: `List | Map`, the close button, locate. Inline: open the full map. */
  expanded?: boolean;
  mode?: MapMode;
  onModeChange?: (mode: MapMode) => void;
  onExpand?: () => void;
  onClose?: () => void;
  onLocate?: () => void;
  /** The blue dot is up: the locate arrow turns `primary`. */
  located?: boolean;
  locating?: boolean;
  onViewList?: () => void;
  /** The MapFilterRow, under the top bar. */
  children?: ReactNode;
  /** App addition: the top block's height, so content below it (the List view, notices) can start under it. */
  onTopHeight?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The corner stack sits this far up: clear of Google's logo (bottom left), its terms strip (bottom
 * right) and the OpenStreetMap credit above the logo (bundle.css `.bv-mapctl-corner { bottom: 36px }`).
 */
export const MAP_CORNER_CLEARANCE = 36;
/** bundle.css `.bv-mapseg-opt`: 34pt segments at least 88 wide, inside a 2pt padded rim. */
const SEG_HEIGHT = 34;
const SEG_MIN_WIDTH = 88;
const SEG_PAD = 2;

/** A 44pt round floating button over the map. */
function MapButton({ icon, label, onPress, active = false, busy = false }: { icon: IconName; label: string; onPress?: () => void; active?: boolean; busy?: boolean }) {
  const { colors, elevation } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      aria-busy={busy}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: colors.surface, borderColor: colors.border, boxShadow: elevation.floating },
        pressed && PRESSED,
      ]}
    >
      <Icon name={icon} size={22} strokeWidth={2} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

function Segments({ mode, onChange }: { mode: MapMode; onChange?: (m: MapMode) => void }) {
  const { colors, elevation } = useTheme();
  const option = (id: MapMode, icon: IconName, label: string) => {
    const on = mode === id;
    const fg = on ? colors.onPrimary : colors.primary;
    return (
      <Pressable
        key={id}
        onPress={() => onChange?.(id)}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: on }}
        aria-checked={on}
        style={({ pressed }) => [styles.seg, on && { backgroundColor: colors.primary }, pressed && PRESSED]}
      >
        <HitTarget height={SEG_HEIGHT} />
        <Icon name={icon} size={18} strokeWidth={2} color={fg} />
        <Text style={[type.heading, { color: fg }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Show spots as"
      style={[styles.segs, { borderColor: colors.primary, backgroundColor: colors.surface, boxShadow: elevation.floating }]}
    >
      {option('list', 'list', 'List')}
      {option('map', 'map-pin', 'Map')}
    </View>
  );
}

/**
 * The map's floating controls (design system MapControls). Inline: the filter row on top, and "open
 * the full map" over `View List` at the bottom right. Full screen: `List | Map` and close on top, the
 * filter row under them, and locate over `View List`. In list mode the corner goes.
 */
export function MapControls({
  expanded = false,
  mode = 'map',
  onModeChange,
  onExpand,
  onClose,
  onLocate,
  located = false,
  locating = false,
  onViewList,
  children,
  onTopHeight,
  style,
}: MapControlsProps) {
  const { colors, elevation } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="box-none">
      <View style={styles.top} pointerEvents="box-none" onLayout={(e) => onTopHeight?.(e.nativeEvent.layout.height)}>
        {expanded ? (
          <View style={styles.bar} pointerEvents="box-none">
            <View style={styles.spacer} />
            <Segments mode={mode} onChange={onModeChange} />
            <MapButton icon="x" label="Close map" onPress={onClose} />
          </View>
        ) : null}
        {children}
      </View>
      {mode === 'map' ? (
        <View style={styles.corner} pointerEvents="box-none">
          {expanded ? (
            <MapButton icon="navigation" label="Show where I am" onPress={onLocate} active={located} busy={locating} />
          ) : (
            <MapButton icon="maximize-2" label="Open the full map" onPress={onExpand} />
          )}
          <Pressable
            onPress={onViewList}
            accessibilityRole="button"
            accessibilityLabel="View List"
            style={({ pressed }) => [styles.viewList, { backgroundColor: colors.primary, boxShadow: elevation.floating }, pressed && PRESSED]}
          >
            <Icon name="list" size={20} strokeWidth={2} color={colors.onPrimary} />
            <Text style={[type.heading, { color: colors.onPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
              View List
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.gutter },
  spacer: { width: size.target },
  segs: { flexDirection: 'row', padding: SEG_PAD, borderWidth: 1, borderRadius: radius.pill },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: SEG_MIN_WIDTH,
    height: SEG_HEIGHT,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  corner: { position: 'absolute', right: spacing.gutter, bottom: MAP_CORNER_CLEARANCE, alignItems: 'flex-end', gap: spacing.md },
  round: {
    width: size.target,
    height: size.target,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  viewList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: size.target,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
});

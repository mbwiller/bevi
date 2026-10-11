import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion, size, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface Tab {
  id: string;
  label: string;
  icon?: IconName;
  chevron?: boolean;
}

export interface SegmentedTabsProps {
  tabs: Tab[];
  /** Controlled selection. Leave undefined to let the tabs hold their own (starting on the first). */
  value?: string;
  onChange?: (id: string) => void;
  /** underline-text: 20pt text tabs that scroll sideways. underline-icon: equal-width icon + 17pt label tabs. */
  variant?: 'underline-text' | 'underline-icon';
  /** The active label and bar: `text` (default) or `primary` (Add Bev). */
  accent?: 'text' | 'primary';
  style?: StyleProp<ViewStyle>;
}

const BAR = 3;
/** The bar is drawn this wide and scaled to the tab, so only its transform animates. */
const BAR_BASE = 100;
/** bundle.css `.bv-tabs-bar`: cubic-bezier(.2,.8,.2,1). */
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

type Frame = { x: number; width: number };

/** Underline tabs with an animated 3pt bar (250ms; it jumps under reduced motion). */
export function SegmentedTabs({ tabs, value, onChange, variant = 'underline-text', accent = 'text', style }: SegmentedTabsProps) {
  const { colors } = useTheme();
  const [own, setOwn] = useState(value ?? tabs[0]?.id);
  const active = value ?? own;
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const text = variant === 'underline-text';
  const accentColor = accent === 'primary' ? colors.primary : colors.text;
  const frame = active != null ? frames[active] : undefined;

  useEffect(() => {
    if (!frame) return;
    // The first placement never animates; later moves do unless reduced motion is on.
    const animate = !reduced && w.value > 0;
    x.value = animate ? withTiming(frame.x, { duration: motion.base, easing: EASE }) : frame.x;
    w.value = animate ? withTiming(frame.width, { duration: motion.base, easing: EASE }) : frame.width;
  }, [frame, reduced, x, w]);

  const bar = useAnimatedStyle(() => ({
    opacity: w.value > 0 ? 1 : 0,
    transform: [{ translateX: x.value }, { scaleX: w.value / BAR_BASE }],
  }));

  const pick = (id: string) => {
    setOwn(id);
    onChange?.(id);
  };
  const measure = (id: string) => (e: LayoutChangeEvent) => {
    const { x: fx, width } = e.nativeEvent.layout;
    setFrames((f) => (f[id]?.x === fx && f[id]?.width === width ? f : { ...f, [id]: { x: fx, width } }));
  };

  const list = (
    <View role="tablist" style={[styles.list, text ? styles.listText : styles.listIcon]}>
      {tabs.map((t) => {
        const on = t.id === active;
        const fg = on ? accentColor : colors.textSecondary;
        return (
          <Pressable
            key={t.id}
            onPress={() => pick(t.id)}
            onLayout={measure(t.id)}
            role="tab"
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            // react-native-web drops accessibilityState; it renders aria-selected.
            aria-selected={on}
            style={[styles.tab, !text && styles.tabEqual]}
          >
            {t.icon ? <Icon name={t.icon} size={20} strokeWidth={1.75} color={fg} /> : null}
            <Text style={[text ? type.tabLabel : type.heading, { color: fg }]} numberOfLines={1}>
              {t.label}
            </Text>
            {t.chevron ? <Icon name="chevron-down" size={16} strokeWidth={2} color={fg} /> : null}
          </Pressable>
        );
      })}
      <Animated.View
        pointerEvents="none"
        aria-hidden
        testID="tabs-bar"
        style={[styles.bar, { backgroundColor: accentColor }, bar]}
      />
    </View>
  );

  return (
    <View style={[styles.tabs, style]}>
      {/* The hairline sits behind the list so the bar covers it, as the design system's bar does at bottom: -1px. */}
      <View style={[styles.hairline, { backgroundColor: colors.border }]} />
      {text ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {list}
        </ScrollView>
      ) : (
        list
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { alignSelf: 'stretch' },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
  list: { flexDirection: 'row' },
  listText: { gap: spacing.xl, paddingHorizontal: spacing.gutter },
  listIcon: { alignSelf: 'stretch' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: size.target,
    paddingBottom: BAR,
  },
  tabEqual: { flex: 1, flexBasis: 0 },
  bar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: BAR_BASE,
    height: BAR,
    transformOrigin: 'left',
  },
});

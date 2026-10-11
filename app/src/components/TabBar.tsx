import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';

export type TabId = 'feed' | 'lists' | 'add' | 'leaderboard' | 'profile';

export interface TabBarProps {
  active?: TabId;
  /** For the Profile tab's avatar. Without it the tab shows the `user` icon. */
  user?: { name: string; src?: string };
  onChange?: (id: TabId) => void;
  /** Pads the bottom by the home-indicator inset (env(safe-area-inset-bottom) on web; 34pt on a home-screen iPhone). */
  safeArea?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TABS: { id: TabId; label: string; icon?: IconName }[] = [
  { id: 'feed', label: 'Feed', icon: 'newspaper' },
  { id: 'lists', label: 'Your Lists', icon: 'list' },
  { id: 'add', label: 'Add Bev' },
  { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy' },
  { id: 'profile', label: 'Profile' },
];

const ICON_BOX = 32;
const ADD = 32;
const ACTIVE_RING = 1.5;

/** The five-tab bar. Centre tab: a 32pt `primary` circle with a plus, inline with the others; Profile is the user's Avatar. */
export function TabBar({ active = 'feed', user, onChange, safeArea = true, style }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      role="navigation"
      aria-label="Main"
      style={[
        styles.bar,
        { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: safeArea ? insets.bottom : 0 },
        style,
      ]}
    >
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange?.(t.id)}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            // react-native-web drops accessibilityState; the design system marks the current tab with aria-current.
            {...(on ? ({ 'aria-current': 'page' } as object) : null)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View style={styles.icon}>
              {t.id === 'add' ? (
                <View style={[styles.add, { backgroundColor: colors.primary }]}>
                  <Icon name="plus" size={22} strokeWidth={2.25} color={colors.onPrimary} />
                </View>
              ) : t.id === 'profile' ? (
                user ? (
                  <Avatar
                    name={user.name}
                    src={user.src}
                    size={32}
                    style={on && { borderWidth: ACTIVE_RING, borderColor: colors.text }}
                  />
                ) : (
                  <Icon name="user" size={28} strokeWidth={on ? 2 : 1.5} color={colors.text} />
                )
              ) : (
                <Icon name={t.icon!} size={28} strokeWidth={1.5} color={colors.text} />
              )}
            </View>
            <Text
              style={[type.tabBar, { color: colors.text }, on && styles.labelOn]}
              maxFontSizeMultiplier={1}
              numberOfLines={1}
              aria-hidden
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Geometry from bundle.css `.bv-tabbar`.
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: spacing.xs,
  },
  item: { flex: 1, flexBasis: 0, alignItems: 'center', gap: 3, minHeight: size.target },
  icon: { height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  add: { width: ADD, height: ADD, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  labelOn: { fontWeight: '700' },
  pressed: { opacity: 0.6 },
});

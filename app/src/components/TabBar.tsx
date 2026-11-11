import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';

export type TabId = 'feed' | 'lists' | 'add' | 'map' | 'profile';

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
  { id: 'lists', label: 'Lists', icon: 'list' },
  { id: 'add', label: 'Add Bev' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'profile', label: 'Profile' },
];

/** The 32pt box every tab's icon sits in (bundle.css `.bv-tabbar-icon`). */
const ICON_BOX = 32;
/** The Add Bev circle (bundle.css `.bv-tabbar-add`): 46pt, its bottom on the icon box's, so it rises 14pt above the other icons. */
const ADD = 46;
/** The `surface` ring that parts the raised circle from the bar's top hairline. */
const ADD_RING = 4;
/** Active Profile: a 2pt `surface` gap, then a 1.5pt `primary` ring (`0 0 0 2px, 0 0 0 3.5px`). */
const AVATAR_GAP = 2;
const AVATAR_RING = 1.5;
/** Paints the bar, and the circle that rises out of it, above the screens (the tab navigator draws them first). */
const BAR_LAYER = 1;

/**
 * The five-tab bar: Feed, Lists, Add Bev, Map, Profile. The active tab's icon and label turn
 * `primary` (icon stroke 2, label bold). Add Bev is a raised 46pt `primary` circle with a plus;
 * Profile is the user's Avatar, ringed in `primary` when active.
 */
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
        const tint = on ? colors.primary : colors.text;
        const stroke = on ? 2 : 1.5;
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
            <View style={[styles.icon, t.id === 'add' && styles.iconAdd]}>
              {t.id === 'add' ? (
                <View
                  testID="tab-add-circle"
                  style={[styles.add, { backgroundColor: colors.primary, boxShadow: `0 0 0 ${ADD_RING}px ${colors.surface}` }]}
                >
                  <Icon name="plus" size={26} strokeWidth={2.25} color={colors.onPrimary} />
                </View>
              ) : t.id === 'profile' ? (
                user ? (
                  <Avatar
                    name={user.name}
                    src={user.src}
                    size={32}
                    style={
                      on && {
                        boxShadow: `0 0 0 ${AVATAR_GAP}px ${colors.surface}, 0 0 0 ${AVATAR_GAP + AVATAR_RING}px ${colors.primary}`,
                      }
                    }
                  />
                ) : (
                  <Icon name="user" size={28} strokeWidth={stroke} color={tint} />
                )
              ) : (
                <Icon name={t.icon!} size={28} strokeWidth={stroke} color={tint} />
              )}
            </View>
            <Text
              style={[type.tabBar, { color: tint }, on && styles.labelOn]}
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

// Geometry from bundle.css `.bv-tabbar` (the raised centre is `.bv-tabbar-add`).
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: spacing.xs,
    zIndex: BAR_LAYER,
  },
  item: { flex: 1, flexBasis: 0, alignItems: 'center', gap: 3, minHeight: size.target },
  icon: { height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  // The circle is taller than the box: pinned to its bottom, it overflows upward over the hairline.
  iconAdd: { justifyContent: 'flex-end' },
  add: {
    width: ADD,
    height: ADD,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelOn: { fontWeight: '700' },
  pressed: { opacity: 0.6 },
});

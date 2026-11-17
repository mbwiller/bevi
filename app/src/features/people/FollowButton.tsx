import { useCallback, useState } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { useFollow, useUnfollow } from '@/api/hooks';
import { HitTarget, PRESSED } from '@/components/HitTarget';
import { AnimatedPressable } from '@/components/PressFeedback';
import { usePop } from '@/components/usePop';
import { radius, size, spacing, type, useTheme } from '@/theme';

/** The 36pt outlined profile buttons (§6.13): Follow sits where Edit profile is on your own profile. */
const HEIGHT = 36;

/**
 * Follow / unfollow a user, optimistically (`useFollow` / `useUnfollow` flip `isFollowing` and the
 * counts in every cached list at once and roll back on error). Returns `toggle(userId, following)`,
 * where `following` is the state the row shows now. Shared by FollowButton, PeopleList and any
 * screen that renders a follow control.
 */
export function useFollowToggle() {
  const follow = useFollow();
  const unfollow = useUnfollow();
  return useCallback(
    (userId: string, following: boolean) => (following ? unfollow.mutate(userId) : follow.mutate(userId)),
    // The mutation objects change identity every render; their `mutate` functions are stable.
    [follow.mutate, unfollow.mutate],
  );
}

export interface FollowButtonProps {
  userId: string;
  /** The person's display name, for the accessible name ("Follow Friend A"). */
  name: string;
  /** Whether the viewer follows them now (`ProfileRow.isFollowing`). */
  following: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Follow / Following button: `primary` fill to follow, outlined once following. A toggle button
 * (`aria-pressed` = following), 36pt tall with a 44pt hit area. Wires up `useFollowToggle` itself.
 * In list rows, UserRow's own pill takes `useFollowToggle` directly.
 */
export function FollowButton({ userId, name, following, style }: FollowButtonProps) {
  const { colors } = useTheme();
  const toggle = useFollowToggle();
  // A press pops the button like the heart (Change). The button itself scales, so the caller's
  // `style` (the profile row's `flex: 1`) still lands on it; an animated Pressable takes no style
  // function, so the pressed dim is tracked here.
  const pop = usePop();
  const [pressed, setPressed] = useState(false);
  return (
    <AnimatedPressable
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        pop.pop();
        toggle(userId, following);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Follow ${name}`}
      accessibilityState={{ selected: following }}
      {...({ 'aria-pressed': following } as object)}
      style={[
        styles.button,
        following
          ? { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 }
          : { backgroundColor: colors.primary },
        pressed && PRESSED,
        style,
        pop.style,
      ]}
    >
      <HitTarget height={HEIGHT} borderWidth={following ? 1 : 0} />
      <Text style={[type.body, styles.label, { color: following ? colors.text : colors.onPrimary }]} numberOfLines={1}>
        {following ? 'Following' : 'Follow'}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: HEIGHT,
    minWidth: size.target,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontWeight: '600' },
});

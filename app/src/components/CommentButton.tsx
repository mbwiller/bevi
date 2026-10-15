import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatCount } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { TARGET_MIN } from './HitTarget';
import { Icon } from './Icon';

export interface CommentButtonProps {
  /** All comments on the post, printed like other counts ("3", "5k"); hidden at 0. */
  count?: number;
  /** Opens the comments sheet. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** "Comment", plus the count when there is one: "Comment, 3 comments", "Comment, 1 comment". */
export function commentLabel(count: number): string {
  return 'Comment' + (count > 0 ? `, ${count} ${count === 1 ? 'comment' : 'comments'}` : '');
}

/**
 * The post's comment control, right after the heart: a 28pt `message-circle` outline in `text` with
 * the comment count beside it. It has no on state and never turns grape (the heart is the row's only
 * grape icon). The count sits inside the 44pt target, as on LikeButton.
 */
export function CommentButton({ count = 0, onPress, style }: CommentButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={commentLabel(count)} style={[styles.target, style]}>
      <View testID="comment-bubble">
        <Icon name="message-circle" size={size.icon} strokeWidth={1.6} color={colors.text} />
      </View>
      {count > 0 ? (
        <Text
          style={[type.body, styles.count, { color: colors.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          importantForAccessibility="no"
          aria-hidden
        >
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

// bundle.css `.bv-like.bv-comment`: the LikeButton's box (44pt, `space-sm` side padding, `space-xs` gap).
const styles = StyleSheet.create({
  target: { ...TARGET_MIN, flexDirection: 'row', paddingHorizontal: spacing.sm, gap: spacing.xs },
  count: { fontVariant: ['tabular-nums'] },
});

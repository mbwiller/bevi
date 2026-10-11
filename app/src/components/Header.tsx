import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { size, spacing, type, useTheme } from '@/theme';

import { type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Wordmark } from './Wordmark';

export interface HeaderAction {
  icon: IconName;
  /** The accessible name. */
  label: string;
  badge?: number;
  onPress?: () => void;
  /** `filled` for the grey close circle. */
  variant?: 'plain' | 'filled';
}

export interface HeaderProps {
  title?: string;
  /** The bevi wordmark on the left instead of a title (Feed, Add Bev). */
  wordmark?: boolean;
  /** List screens: a centred caps title ("YOUR LISTS", "LEADERBOARD"). */
  centered?: boolean;
  /** 28pt IconButtons on the right. */
  actions?: HeaderAction[];
  /** Pushed screens: a back chevron on the left. */
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The IconButton's 44pt box hangs into the gutter so the glyph lines up with the edge (bundle.css). */
const ICON_OUTDENT = -10;
const ACTIONS_INSET = spacing.gutter - spacing.sm;

/** The 44pt screen header: the wordmark or a 20pt bold title on the left, 28pt icons on the right; or a centred caps title. */
export function Header({ title, wordmark = false, centered = false, actions = [], onBack, style }: HeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.surface }, style]}>
      {centered && title ? (
        <View style={styles.centre} pointerEvents="none">
          <Text style={[type.sectionCaps, { color: colors.text }]} role="heading" aria-level={1} numberOfLines={1}>
            {title}
          </Text>
        </View>
      ) : null}
      <View style={styles.lead}>
        {onBack ? <IconButton icon="chevron-left" label="Back" onPress={onBack} style={styles.back} /> : null}
        {wordmark ? (
          <Wordmark height={28} />
        ) : !centered && title ? (
          <Text style={[type.screenTitle, styles.title, { color: colors.text }]} role="heading" aria-level={1} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {actions.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} badge={a.badge} variant={a.variant} onPress={a.onPress} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    height: size.header,
    paddingLeft: spacing.gutter,
    paddingRight: ACTIONS_INSET,
  },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  lead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0, flexShrink: 1 },
  back: { marginLeft: ICON_OUTDENT },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});

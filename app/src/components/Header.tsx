import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { size, spacing, type, useTheme } from '@/theme';

import { useHeaderLeadAction } from './HeaderActionContext';
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
  /** The bevi wordmark on the left instead of a title (Feed, Search). */
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

/** The width the right-hand actions take, so a centred title can stay clear of them. */
function actionsWidth(count: number): number {
  return count === 0 ? 0 : ACTIONS_INSET + count * size.target + (count - 1) * spacing.xs;
}

/**
 * The 44pt screen header: the wordmark or a 20pt bold title on the left, 28pt icons on the right; or a centred caps title.
 *
 * An app-wide lead action (HeaderActionContext; the internal Report a bug entry) goes first in the
 * actions when one is provided. The actions never wrap or shrink: the title truncates instead.
 */
export function Header({ title, wordmark = false, centered = false, actions = [], onBack, style }: HeaderProps) {
  const { colors } = useTheme();
  const lead = useHeaderLeadAction();
  const all = lead ? [lead, ...actions] : actions;
  // Both sides reserve the wider of the back button and the actions, so the centred title stays centred.
  const reserve = Math.max(actionsWidth(all.length), onBack ? spacing.gutter + size.target : 0);
  return (
    <View style={[styles.header, { backgroundColor: colors.surface }, style]}>
      {centered && title ? (
        <View style={[styles.centre, reserve ? { paddingHorizontal: reserve } : null]} pointerEvents="none">
          <Text style={[type.sectionCaps, styles.centreTitle, { color: colors.text }]} role="heading" aria-level={1} numberOfLines={1}>
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
        {all.map((a) => (
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
  centreTitle: { maxWidth: '100%' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 0 },
});

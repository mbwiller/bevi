import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useSession } from '@/state/session';
import { radius, spacing, type, useTheme } from '@/theme';

import { markAsked, wasAsked } from './push/askedFlag';
import { pushAvailable } from './push/availability';
import { registerThisDevice } from './push/device';
import { requestPushPermission } from './push/push';
import { usePushPermission } from './push/usePushPermission';

export const ASK_TITLE = 'Hear about it when it happens';
export const ASK_BODY = 'Bevi can tell you when someone follows you, likes a Bev you posted or comments on it. You choose which in Settings.';

/** bundle.css `.bv-empty-icon`: a 56pt disc. */
const DISC = 56;

type Choice = 'turnOn' | 'notNow';

/**
 * Whether to show the ask before the iOS prompt (design system ScreenNotificationsAsk), and what
 * its buttons do. Shown once per device, the first time Notifications is in focus with something
 * in it, on a build that can receive push, while the phone has not been asked. Marked as shown the
 * moment it opens, so however it is closed (a button, the scrim, a swipe) it does not come back on
 * its own: Settings > Notifications offers it again.
 *
 * "Turn on notifications" shows the iOS prompt only once the sheet has really closed (`onClosed`:
 * iOS cannot present its alert over a Modal that is still going), and registers the device if the
 * answer is yes.
 */
export function useNotificationsAsk(hasRows: boolean) {
  const available = pushAvailable();
  const { permission } = usePushPermission();
  const account = useSession((s) => s.profile?.handle);
  const [asked, setAsked] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const choice = useRef<Choice | null>(null);

  useEffect(() => {
    if (!available) return;
    let live = true;
    void wasAsked().then((a) => {
      if (live) setAsked(a);
    });
    return () => {
      live = false;
    };
  }, [available]);

  useFocusEffect(
    useCallback(() => {
      if (!available || asked !== false || permission !== 'undetermined' || !hasRows) return;
      setAsked(true);
      void markAsked();
      setOpen(true);
    }, [available, asked, permission, hasRows]),
  );

  const choose = useCallback((c: Choice) => {
    choice.current = c;
    setOpen(false);
  }, []);

  const onClosed = useCallback(() => {
    const c = choice.current;
    choice.current = null;
    if (c !== 'turnOn') return;
    void (async () => {
      if ((await requestPushPermission()) === 'granted' && account) await registerThisDevice(account);
    })();
  }, [account]);

  return { open, choose, onClosed };
}

/** The ask's Sheet: the bell, a title, one line of what is sent, Turn on notifications and Not now. */
export function NotificationsAsk({
  open,
  onChoose,
  onClosed,
}: {
  open: boolean;
  onChoose: (choice: Choice) => void;
  onClosed: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet open={open} snap={40} onClose={() => onChoose('notNow')} onClosed={onClosed}>
      <View style={styles.body} testID="notifications-ask">
        <View style={[styles.disc, { backgroundColor: colors.primaryTint }]}>
          <Icon name="bell" size={28} strokeWidth={1.75} color={colors.primary} />
        </View>
        <Text style={[type.screenTitle, styles.center, { color: colors.text }]} role="heading">
          {ASK_TITLE}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.textSecondary }]}>{ASK_BODY}</Text>
        <View style={styles.actions}>
          <Button variant="primary" block onPress={() => onChoose('turnOn')}>
            Turn on notifications
          </Button>
          <Button variant="ghost" block onPress={() => onChoose('notNow')}>
            Not now
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs, paddingHorizontal: spacing.xl },
  disc: { width: DISC, height: DISC, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.md },
});

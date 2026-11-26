import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useChosenPeopleCount, useNotificationSettings, useUpdateNotificationSettings, type ChosenCount } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { SettingsRow, SettingsScreen, SettingsSection, SettingsSwitchRow } from '@/features/settings/SettingsRow';
import { actionErrorMessage } from '@/lib/errorCopy';
import { useSession } from '@/state/session';
import { spacing, type, useTheme } from '@/theme';

import { registerThisDevice } from './push/device';
import { openSystemSettings, requestPushPermission } from './push/push';
import { usePushPermission } from './push/usePushPermission';
import { shownAs, type NotificationSettingKey } from './settingsRules';

export const NOTIFICATION_SETTINGS_TITLE = 'Notifications';
export const PAUSE_CAPTION = 'Switches every kind off for now';
export const PAUSED_CAPTION = 'Nothing is sent to this phone';
export const SETTINGS_NOTE = 'Follows, likes and comments still show up in the app, whatever you switch off here.';
export const TURN_ON_LINE = "Notifications aren't on for Bevi on this phone yet. Nothing below is sent until they are.";
export const DENIED_LINE = "Notifications are off for Bevi in this phone's Settings.";
export const SAVE_FAILED = "Couldn't save that change.";

/** The "Choose people" row's value: "No one yet", "1 person", "N people", "100+ people". */
export function chosenCountLabel(chosen: ChosenCount): string {
  if (chosen.capped) return `${chosen.count}+ people`;
  if (chosen.count === 0) return 'No one yet';
  return chosen.count === 1 ? '1 person' : `${chosen.count} people`;
}

const KIND_ROWS: { key: Exclude<NotificationSettingKey, 'paused'>; label: string; caption?: string }[] = [
  { key: 'follows', label: 'New followers' },
  { key: 'likes', label: 'Likes', caption: 'On Bevs you posted' },
  { key: 'comments', label: 'Comments', caption: 'On Bevs you posted' },
  { key: 'posts', label: 'Posts', caption: 'When people you choose post a Bev' },
];

/**
 * Settings > Notifications (`/settings/notifications`, T-31 Release 2; design system
 * ScreenNotificationSettings): what Bevi may send to this phone. Pause all, then one switch per
 * kind, then Choose people (Post notifications). Every switch goes through `applySettingToggle`, and
 * the whole object is saved, one save at a time in tap order (`useUpdateNotificationSettings`). These change what is pushed only, never what the inbox lists.
 *
 * Above them, what the phone itself allows: a way to turn notifications on while it has not been
 * asked, and a way to the phone's Settings once it said no. The switches work in every case: they
 * are the account's. Reached only on a build that can receive push (`pushAvailable()`).
 */
export function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const query = useNotificationSettings();
  const save = useUpdateNotificationSettings();
  const chosen = useChosenPeopleCount();
  const { permission, refresh } = usePushPermission();
  const account = useSession((s) => s.profile?.handle);

  // The hook applies the tap with `applySettingToggle` and saves the whole object, in tap order.
  const { mutate } = save;
  const toggle = useCallback((key: NotificationSettingKey, on: boolean) => mutate({ key, on }), [mutate]);

  const turnOn = useCallback(async () => {
    const answer = await requestPushPermission();
    await refresh();
    if (answer === 'granted' && account) void registerThisDevice(account);
  }, [refresh, account]);

  if (query.isPending) {
    return (
      <SettingsScreen title={NOTIFICATION_SETTINGS_TITLE}>
        <View accessibilityLabel="Loading" testID="notification-settings-skeleton" style={styles.skeleton}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} lines={2} />
          ))}
        </View>
      </SettingsScreen>
    );
  }
  if (query.isError) {
    return (
      <SettingsScreen title={NOTIFICATION_SETTINGS_TITLE}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </SettingsScreen>
    );
  }

  const settings = query.data;
  const failure = save.isError ? `${SAVE_FAILED} ${actionErrorMessage(save.error)}` : null;

  return (
    <SettingsScreen title={NOTIFICATION_SETTINGS_TITLE}>
      {permission === 'undetermined' ? (
        <View style={styles.permission} testID="notifications-permission-undetermined">
          <Text style={[type.body, { color: colors.textSecondary }]}>{TURN_ON_LINE}</Text>
          <Button variant="primary" block onPress={() => void turnOn()}>
            Turn on notifications
          </Button>
        </View>
      ) : permission === 'denied' ? (
        <View style={styles.permission} testID="notifications-permission-denied">
          <Text style={[type.body, { color: colors.text }]}>{DENIED_LINE}</Text>
          <Button block onPress={openSystemSettings}>
            Open Settings
          </Button>
        </View>
      ) : null}
      <SettingsSection>
        <SettingsSwitchRow
          label="Pause all"
          caption={settings.paused ? PAUSED_CAPTION : PAUSE_CAPTION}
          checked={shownAs(settings, 'paused')}
          onChange={(on) => toggle('paused', on)}
        />
      </SettingsSection>
      <SettingsSection title="Tell me about">
        {KIND_ROWS.map((row) => (
          <SettingsSwitchRow
            key={row.key}
            label={row.label}
            caption={row.caption}
            checked={shownAs(settings, row.key)}
            onChange={(on) => toggle(row.key, on)}
          />
        ))}
        <SettingsRow
          label="Choose people"
          value={chosen.data ? chosenCountLabel(chosen.data) : undefined}
          onPress={() => router.push('/settings/post-notifications')}
        />
      </SettingsSection>
      <Announce text={failure} />
      {failure ? (
        <Text style={[type.caption, styles.note, { color: colors.scoreLow }]} role="alert">
          {failure}
        </Text>
      ) : null}
      <Text style={[type.caption, styles.note, { color: colors.textSecondary }]}>{SETTINGS_NOTE}</Text>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  permission: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  note: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
});

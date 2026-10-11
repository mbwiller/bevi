import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { useSignOut } from '@/api/hooks';
import { sessionOverrideEnabled } from '@/dev/devSession';
import { errorCopy } from '@/lib/errorCopy';
import { SettingsRow, SettingsScreen, SettingsSection } from '@/features/settings/SettingsRow';
import { useSession } from '@/state/session';
import { spacing, type, useTheme } from '@/theme';

/**
 * Settings (§6.18): Account, Privacy, Sign out, Delete account. Signing out clears the session;
 * the root gate then lands on sign in. The dev links show only while the dev override is on (mock API).
 */
export default function SettingsIndexScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const signOut = useSignOut();
  const version = Constants.expoConfig?.version;

  const onSignOut = () =>
    signOut.mutate(undefined, {
      // onAuthChange also reaches the session bootstrap; this makes the store change immediate.
      onSuccess: () => useSession.getState().signOut(),
    });

  return (
    <SettingsScreen title="Settings">
      <SettingsSection title="Your account">
        <SettingsRow label="Account" onPress={() => router.push('/settings/account')} />
        <SettingsRow label="Privacy" onPress={() => router.push('/settings/privacy')} />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow label="Sign out" chevron={false} busy={signOut.isPending} onPress={onSignOut} />
        <SettingsRow label="Delete account" onPress={() => router.push('/settings/delete-account')} />
      </SettingsSection>
      {signOut.isError ? (
        <Text style={[type.body, styles.note, { color: colors.scoreLow }]} accessibilityLiveRegion="polite" role="alert">
          {`Couldn't sign out. ${errorCopy(signOut.error).message}`}
        </Text>
      ) : null}
      {sessionOverrideEnabled() ? (
        <SettingsSection title="Developer">
          <SettingsRow label="Component gallery" onPress={() => router.push('/dev/gallery')} />
          <SettingsRow label="Token preview" onPress={() => router.push('/dev/tokens')} />
        </SettingsSection>
      ) : null}
      {version ? <Text style={[type.caption, styles.note, { color: colors.textSecondary }]}>{`Bevi ${version}`}</Text> : null}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
});

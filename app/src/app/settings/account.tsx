import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useMe, useUpdateMe } from '@/api/hooks';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { errorCopy } from '@/lib/errorCopy';
import { HANDLE_READ_ONLY_HINT } from '@/features/profile/EditProfileSheet';
import { useSaveDisplayName } from '@/features/profile/useSaveDisplayName';
import { SettingsScreen, SettingsSection } from '@/features/settings/SettingsRow';
import { spacing, type, useTheme } from '@/theme';

/** "Apr 12, 1996" for an ISO date (YYYY-MM-DD), read as a calendar date (no timezone shift). */
function formatBirthdate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * Settings › Account (§6.18): username (read-only: it is the sign-in name), display name, birthdate
 * read-only (§6.17: set once in onboarding, an admin corrects it), and timezone, which can be reset
 * to this device's.
 */
export default function AccountScreen() {
  const { colors } = useTheme();
  const me = useMe();
  const { save, error, clearError, saving } = useSaveDisplayName();
  const tz = useUpdateMe();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const device = deviceTimeZone();

  const loadedName = me.data?.displayName;
  useEffect(() => {
    if (loadedName !== undefined) setName(loadedName);
  }, [loadedName]);

  if (me.isPending) {
    return (
      <SettingsScreen title="Account">
        <View style={styles.form} accessibilityLabel="Loading">
          <Skeleton variant="block" height={48} />
          <Skeleton variant="block" height={48} />
          <Skeleton variant="block" height={48} />
        </View>
      </SettingsScreen>
    );
  }
  if (me.isError) {
    return (
      <SettingsScreen title="Account">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </SettingsScreen>
    );
  }

  const profile = me.data;
  const unchanged = name.trim() === profile.displayName;
  const secondary = { color: colors.textSecondary };

  return (
    <SettingsScreen title="Account">
      <View style={styles.form}>
        <TextField label="Username" value={profile.handle} prefix="@" editable={false} hint={HANDLE_READ_ONLY_HINT} />
        <TextField
          label="Display name"
          value={name}
          onChange={(v) => {
            setName(v);
            setSaved(false);
            if (error) clearError();
          }}
          error={error}
          hint={saved ? 'Saved' : undefined}
          autoComplete="name"
          autoCapitalize="words"
        />
        <Button
          variant="primary"
          block
          loading={saving}
          disabled={unchanged}
          onPress={async () => {
            if (await save(name)) setSaved(true);
          }}
        >
          Save name
        </Button>
        <TextField
          label="Birthdate"
          value={profile.birthdate ? formatBirthdate(profile.birthdate) : 'Not set'}
          editable={false}
          hint="This can't be changed. Contact us to correct it."
        />
      </View>
      <SettingsSection title="Timezone">
        <View style={styles.tz}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>{profile.timezone}</Text>
          <Text style={[type.body, secondary]}>Used to count your streak days.</Text>
          {device && device !== profile.timezone ? (
            <Button
              loading={tz.isPending}
              onPress={() => tz.mutate({ timezone: device })}
              accessibilityLabel={`Use this device's timezone, ${device}`}
              style={styles.tzButton}
            >
              {`Use ${device}`}
            </Button>
          ) : null}
          {tz.isError ? (
            <Text style={[type.caption, { color: colors.scoreLow }]} role="alert">
              {`Couldn't change the timezone. ${errorCopy(tz.error).message}`}
            </Text>
          ) : null}
        </View>
      </SettingsSection>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  tz: { gap: spacing.xs, paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  tzButton: { marginTop: spacing.sm },
});

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Profile } from '@bevi/shared';

import { useMe, useSetBirthDate, useUpdateMe } from '@/api/hooks';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { FormError } from '@/features/auth/AuthScreen';
import { errorField, formErrorMessage } from '@/features/auth/formError';
import { birthdateProblem, deviceTimezone, isUnder21, maskBirthdate } from '@/features/onboarding/birthdate';
import { spacing, type, useTheme } from '@/theme';

const NAME_MAX = 50;
const FORM_MAX = 420;
const SKELETON_FIELD = 48;
const BIRTHDATE_HINT = "Set once. Used only to show 21+ categories. Can't be changed later without contacting us.";

/** §6.2 Onboarding step 1: display name, birthdate (set once, §6.17), timezone captured silently. */
export default function OnboardingProfileScreen() {
  const { colors } = useTheme();
  const me = useMe();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Your profile" />
      {me.data ? (
        <ProfileForm me={me.data} />
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} style={styles.state} />
      ) : (
        <View style={[styles.body, styles.column]} accessibilityLabel="Loading your profile" aria-busy>
          <Skeleton variant="circle" width={100} height={100} style={styles.avatar} />
          <Skeleton variant="block" height={SKELETON_FIELD} />
          <Skeleton variant="block" height={SKELETON_FIELD} />
        </View>
      )}
    </SafeAreaView>
  );
}

function ProfileForm({ me }: { me: Profile }) {
  const { colors } = useTheme();
  const router = useRouter();
  const updateMe = useUpdateMe();
  const setBirthDate = useSetBirthDate();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [birthdate, setBirthdate] = useState(me.birthdate ?? '');
  const [error, setError] = useState<{ field?: 'displayName' | 'birthdate'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const birthdateLocked = me.birthdate !== null;

  const name = displayName.trim();
  const problem = birthdateLocked ? null : birthdateProblem(birthdate);
  const valid = name.length > 0 && problem === null;
  const birthdateError =
    error?.field === 'birthdate'
      ? error.message
      : problem === 'invalid'
        ? 'Enter a real date, like 1995-04-23'
        : problem === 'future'
          ? "That date hasn't happened yet"
          : undefined;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const timezone = deviceTimezone();
      await updateMe.mutateAsync({ displayName: name, ...(timezone ? { timezone } : null) });
      if (!birthdateLocked) await setBirthDate.mutateAsync(birthdate);
      router.push('/onboarding/starter');
    } catch (e) {
      const field = errorField(e);
      if (field === 'displayName' || field === 'birthdate') setError({ field, message: (e as Error).message });
      else setError({ message: formErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <Avatar name={name || me.handle} src={me.avatarUrl ?? undefined} size={100} style={styles.avatar} />
        <TextField
          label="Display name"
          value={displayName}
          onChange={(v) => {
            setDisplayName(v);
            if (error?.field === 'displayName') setError(null);
          }}
          onSubmit={() => void submit()}
          hint="How friends see you. You can change it later."
          error={error?.field === 'displayName' ? error.message : name ? undefined : 'Enter a name'}
          maxLength={NAME_MAX}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          autoFocus
        />
        <TextField
          label="Birthdate"
          value={birthdate}
          onChange={(v) => {
            setBirthdate(maskBirthdate(v));
            if (error?.field === 'birthdate') setError(null);
          }}
          onSubmit={() => void submit()}
          placeholder="YYYY-MM-DD"
          type="numeric"
          hint={birthdateLocked ? 'Already set. Contact us to correct it.' : BIRTHDATE_HINT}
          error={birthdateError}
          maxLength={10}
          autoComplete="off"
          enterKeyHint="go"
          editable={!birthdateLocked}
        />
        {problem === null && birthdate && isUnder21(birthdate) ? (
          <Text style={[type.body, { color: colors.textSecondary }]}>
            You're under 21, so beer, wine and cocktail categories stay hidden until your 21st birthday.
          </Text>
        ) : null}
        <FormError>{error && !error.field ? error.message : null}</FormError>
        <Button variant="primary" block disabled={!valid} loading={saving} onPress={() => void submit()}>
          Continue
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flexGrow: 1, padding: spacing.gutter },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', gap: spacing.lg },
  avatar: { alignSelf: 'center', marginBottom: spacing.sm },
  state: { flex: 1 },
});

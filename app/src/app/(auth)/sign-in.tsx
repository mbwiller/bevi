import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isApiError } from '@bevi/shared';

import { useSignIn } from '@/api/hooks';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { AuthScreen, FormError } from '@/features/auth/AuthScreen';
import { formErrorMessage } from '@/features/auth/formError';
import { spacing, type, useTheme } from '@/theme';

/** §6.1 Sign in: username + password. The root gate moves on once the session's profile loads. */
export default function SignInScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const signIn = useSignIn();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<{ username?: string; password?: string }>({});

  const submit = () => {
    if (signIn.isPending || signIn.isSuccess) return;
    const name = username.trim().toLowerCase();
    const next = {
      username: name ? undefined : 'Enter your username',
      password: password ? undefined : 'Enter your password',
    };
    setMissing(next);
    if (next.username || next.password) return;
    signIn.mutate({ username: name, password });
  };

  const wrong = isApiError(signIn.error) && signIn.error.code === 'unauthorized';
  const formError = signIn.error
    ? wrong
      ? 'Wrong username or password. Check them and try again.'
      : formErrorMessage(signIn.error)
    : null;

  return (
    <AuthScreen>
      <TextField
        label="Username"
        prefix="@"
        value={username}
        onChange={(v) => {
          setUsername(v);
          setMissing((m) => ({ ...m, username: undefined }));
        }}
        onSubmit={submit}
        error={missing.username}
        autoComplete="username"
        autoCapitalize="none"
        enterKeyHint="next"
        autoFocus
      />
      <TextField
        label="Password"
        type="password"
        value={password}
        onChange={(v) => {
          setPassword(v);
          setMissing((m) => ({ ...m, password: undefined }));
        }}
        onSubmit={submit}
        error={missing.password}
        autoComplete="current-password"
        enterKeyHint="go"
      />
      <FormError>{formError}</FormError>
      <Button variant="primary" block loading={signIn.isPending || signIn.isSuccess} onPress={submit}>
        Sign in
      </Button>
      <Text style={[type.caption, styles.center, { color: colors.textSecondary }]}>
        Forgot your password? Ask an admin to reset it.
      </Text>
      <View style={styles.switch}>
        <Text style={[type.body, { color: colors.textSecondary }]}>New to Bevi?</Text>
        <Button variant="ghost" onPress={() => router.push('/sign-up')}>
          Create account
        </Button>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});

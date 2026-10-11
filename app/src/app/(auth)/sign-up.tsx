import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isApiError } from '@bevi/shared';

import { useCheckHandle, useSignUp } from '@/api/hooks';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { AuthScreen, FormError } from '@/features/auth/AuthScreen';
import { focusField } from '@/features/auth/focusField';
import { errorField, formErrorMessage, PASSWORD_MIN_LENGTH } from '@/features/auth/formError';
import { HANDLE_RULE, localHandleProblem } from '@/features/auth/handle';
import { useDebouncedValue } from '@/features/auth/useDebouncedValue';
import { useBack } from '@/lib/useBack';
import { spacing, type, useTheme } from '@/theme';

const CHECK_DEBOUNCE_MS = 400;
const PASSWORD_ID = 'sign-up-password';
const INVITE_ID = 'sign-up-invite';
const TAKEN = 'That username is taken. Try another.';
const INVITE_WRONG = "That invite code isn't right. Check it with whoever invited you.";

type Field = 'username' | 'password' | 'inviteCode';

/** §6.1 Sign up: username (the handle, checked as you type), password, invite code. */
export default function SignUpScreen() {
  const { colors } = useTheme();
  const back = useBack();
  const signUp = useSignUp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // A server error stays on its field until that field changes.
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});

  const handle = username.trim().toLowerCase();
  const local = localHandleProblem(handle);
  const debounced = useDebouncedValue(handle, CHECK_DEBOUNCE_MS);
  const check = useCheckHandle(debounced, { enabled: local === null && debounced === handle });
  const checked = local === null && debounced === handle ? check.data : undefined;

  let usernameError: string | undefined = serverErrors.username;
  let usernameHint = HANDLE_RULE.charAt(0).toUpperCase() + HANDLE_RULE.slice(1);
  if (!usernameError) {
    if (local === 'chars') usernameError = 'Use only lowercase letters, numbers and _';
    else if (local === 'reserved') usernameError = 'That username is reserved. Try another.';
    else if (local === 'empty' && submitted) usernameError = 'Choose a username';
    else if (local === 'length' && submitted) usernameError = `Use ${HANDLE_RULE}`;
    else if (checked && !checked.available) {
      usernameError =
        checked.reason === 'reserved'
          ? 'That username is reserved. Try another.'
          : checked.reason === 'invalid'
            ? `Use ${HANDLE_RULE}`
            : TAKEN;
    } else if (checked?.available) usernameHint = `@${handle} is available`;
    else if (local === null && check.isError) usernameHint = "Couldn't check it now. We'll check when you create the account.";
    else if (local === null) usernameHint = 'Checking…';
  }

  const passwordError =
    serverErrors.password ??
    (submitted && password.length < PASSWORD_MIN_LENGTH ? `Use at least ${PASSWORD_MIN_LENGTH} characters` : undefined);
  const inviteError = serverErrors.inviteCode ?? (submitted && !inviteCode.trim() ? 'Enter your invite code' : undefined);

  const submit = () => {
    if (signUp.isPending || signUp.isSuccess) return;
    setSubmitted(true);
    if (local !== null || (checked && !checked.available) || password.length < PASSWORD_MIN_LENGTH || !inviteCode.trim()) return;
    signUp.mutate(
      { username: handle, password, inviteCode: inviteCode.trim() },
      {
        onError: (e) => {
          if (isApiError(e) && e.code === 'conflict') return setServerErrors({ username: TAKEN });
          const field = errorField(e);
          if (field === 'inviteCode') setServerErrors({ inviteCode: INVITE_WRONG });
          else if (field === 'username' || field === 'password') setServerErrors({ [field]: e.message });
        },
      },
    );
  };

  const change = (field: Field, set: (v: string) => void) => (v: string) => {
    set(v);
    setServerErrors((s) => ({ ...s, [field]: undefined }));
  };

  // Field problems show on their field; anything else (offline, too many tries) under the form.
  const onField = isApiError(signUp.error) && (signUp.error.code === 'conflict' || errorField(signUp.error) !== undefined);
  const formError = signUp.error && !onField ? formErrorMessage(signUp.error) : null;

  return (
    <AuthScreen>
      <TextField
        label="Username"
        prefix="@"
        value={username}
        onChange={change('username', (v) => setUsername(v.toLowerCase()))}
        onSubmit={() => focusField(PASSWORD_ID)}
        hint={usernameHint}
        error={usernameError}
        maxLength={20}
        autoComplete="username"
        autoCapitalize="none"
        enterKeyHint="next"
        autoFocus
      />
      <TextField
        label="Password"
        id={PASSWORD_ID}
        type="password"
        value={password}
        onChange={change('password', setPassword)}
        onSubmit={() => focusField(INVITE_ID)}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
        error={passwordError}
        autoComplete="new-password"
        enterKeyHint="next"
      />
      <TextField
        label="Invite code"
        id={INVITE_ID}
        value={inviteCode}
        onChange={change('inviteCode', setInviteCode)}
        onSubmit={submit}
        hint="Bevi is invite only for now. Ask whoever invited you for the code."
        error={inviteError}
        autoComplete="off"
        autoCapitalize="none"
        enterKeyHint="go"
      />
      <FormError>{formError}</FormError>
      <Button variant="primary" block loading={signUp.isPending || signUp.isSuccess} onPress={submit}>
        Create account
      </Button>
      <View style={styles.switch}>
        <Text style={[type.body, { color: colors.textSecondary }]}>Already have an account?</Text>
        <Button variant="ghost" onPress={back}>
          Sign in
        </Button>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});

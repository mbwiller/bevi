import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useDeleteAccount } from '@/api/hooks';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { errorCopy } from '@/lib/errorCopy';
import { SettingsScreen } from '@/features/settings/SettingsRow';
import { useSession } from '@/state/session';
import { spacing, type, useTheme } from '@/theme';

const CONFIRM_WORD = 'DELETE';

const GONE = ['Your profile, username and display name', 'Every ranking, note and comparison', 'Who you follow and who follows you', 'Your Want to Try list'];

/**
 * Delete account (§6.18): says what goes and what stays, asks for DELETE typed out, then calls
 * `deleteAccount` (which signs out); the gate lands on sign in.
 */
export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const [typed, setTyped] = useState('');
  const del = useDeleteAccount();
  const confirmed = typed.trim() === CONFIRM_WORD;
  const text = { color: colors.text };

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => useSession.getState().signOut(),
    });

  return (
    <SettingsScreen title="Delete account">
      <View style={styles.body}>
        <Text style={[type.bodyLarge, text]}>This permanently deletes your Bevi account. It can't be undone. We delete:</Text>
        <View style={styles.list}>
          {GONE.map((g) => (
            <View key={g} style={styles.item}>
              <Text style={[type.bodyLarge, { color: colors.textSecondary }]} aria-hidden>
                •
              </Text>
              <Text style={[type.bodyLarge, styles.itemText, text]}>{g}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          Bevs you added stay in the catalog for everyone else, without your name on them.
        </Text>
        <TextField
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={typed}
          onChange={setTyped}
          autoCapitalize="characters"
          autoComplete="off"
          onSubmit={() => {
            if (confirmed && !del.isPending) onDelete();
          }}
        />
        {del.isError ? (
          <Text style={[type.body, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
            {`Couldn't delete your account. ${errorCopy(del.error).message}`}
          </Text>
        ) : null}
        <Button variant="primary" block disabled={!confirmed} loading={del.isPending} onPress={onDelete}>
          Delete account
        </Button>
      </View>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  list: { gap: spacing.xs },
  item: { flexDirection: 'row', gap: spacing.sm },
  itemText: { flex: 1, minWidth: 0 },
});

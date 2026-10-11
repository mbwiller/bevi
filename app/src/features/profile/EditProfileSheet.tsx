import type { Profile } from '@bevi/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { spacing } from '@/theme';

import { useSaveDisplayName } from './useSaveDisplayName';

export interface EditProfileSheetProps {
  open: boolean;
  profile: Profile;
  onClose: () => void;
}

/** Shared with Settings › Account: the handle is the sign-in username, so it is shown, not edited. */
export const HANDLE_READ_ONLY_HINT = "Your username is how you sign in, so it can't be changed here.";

/**
 * Edit profile (§6.19): display name, with a live initials preview, and the handle read-only.
 * `updateMe` accepts a handle, but the handle is also the sign-in username, so changing it here
 * would change how the person signs in; that stays an admin change for now.
 */
export function EditProfileSheet({ open, profile, onClose }: EditProfileSheetProps) {
  const [name, setName] = useState(profile.displayName);
  const { save, error, clearError, saving } = useSaveDisplayName();

  // Start from the saved name each time the sheet opens.
  useEffect(() => {
    if (open) {
      setName(profile.displayName);
      clearError();
    }
  }, [open, profile.displayName, clearError]);

  const submit = async () => {
    if ((await save(name)) !== null) onClose();
  };

  const unchanged = name.trim() === profile.displayName;

  return (
    <Sheet open={open} title="Edit profile" snap={90} onClose={onClose}>
      <View style={styles.body}>
        <Avatar name={name.trim() || profile.displayName} src={profile.avatarUrl ?? undefined} size={100} style={styles.avatar} />
        <TextField
          label="Name"
          value={name}
          onChange={(v) => {
            setName(v);
            if (error) clearError();
          }}
          onSubmit={() => void submit()}
          error={error}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="done"
        />
        <TextField label="Username" value={profile.handle} prefix="@" editable={false} hint={HANDLE_READ_ONLY_HINT} />
        <Button variant="primary" block loading={saving} disabled={unchanged} onPress={() => void submit()}>
          Save
        </Button>
        <Button variant="ghost" block onPress={onClose}>
          Cancel
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  avatar: { alignSelf: 'center' },
});

import { isApiError, type Profile } from '@bevi/shared';
import { useCallback, useState } from 'react';

import { useUpdateMe } from '@/api/hooks';
import { errorCopy } from '@/lib/errorCopy';
import { useSession } from '@/state/session';

/** Field-level copy for a display name the server or the form rejects. */
function nameError(e: unknown): string {
  if (isApiError(e) && e.code === 'validation') return "That name can't be used. Try a shorter one.";
  const copy = errorCopy(e);
  return `${copy.title}. ${copy.message}`;
}

/**
 * Saves a new display name with `profile.updateMe` (Edit profile sheet, Settings › Account) and
 * keeps the shell's session profile (tab-bar avatar) in step. `error` is the field message.
 */
export function useSaveDisplayName() {
  const update = useUpdateMe();
  const [error, setError] = useState<string | undefined>();

  const save = useCallback(
    async (raw: string): Promise<Profile | null> => {
      const displayName = raw.trim();
      if (!displayName) {
        setError('Enter a name.');
        return null;
      }
      setError(undefined);
      try {
        const profile = await update.mutateAsync({ displayName });
        const { handle, avatarUrl } = profile;
        if (useSession.getState().status === 'ready') {
          useSession.getState().completeOnboarding({ handle, displayName: profile.displayName, avatarUrl });
        }
        return profile;
      } catch (e) {
        setError(nameError(e));
        return null;
      }
    },
    // `mutateAsync` is stable across renders.
    [update.mutateAsync],
  );

  const clearError = useCallback(() => setError(undefined), []);

  return { save, error, clearError, saving: update.isPending };
}

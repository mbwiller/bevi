import { isApiError, type Profile } from '@bevi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUpdateMe, useUploadMedia } from '@/api/hooks';
import { AVATAR_MAX_EDGE, isUnsupportedImage, pickImage, preparePhoto, revokeIfBlob, type PreparedPhoto } from '@/features/create-bev/photo';
import { errorCopy } from '@/lib/errorCopy';
import { useSession } from '@/state/session';

const UNSUPPORTED = "That image can't be used. Try a JPEG or PNG.";
const REJECTED = "Couldn't upload your photo. Try another one.";

function avatarError(e: unknown): string {
  if (isUnsupportedImage(e)) return UNSUPPORTED;
  if (isApiError(e) && e.code === 'validation') return REJECTED;
  const copy = errorCopy(e);
  return `${copy.title}. ${copy.message}`;
}

/**
 * Sets or removes the signed-in person's profile photo (Edit profile, onboarding). A chosen photo
 * is picked, resized to `AVATAR_MAX_EDGE` and re-encoded as JPEG, uploaded as an `avatar` asset and
 * saved with `updateMe({ avatarAssetId })` straight away; `remove()` clears it. Like
 * `useSaveDisplayName`, a finished change keeps the session store's profile (the tab-bar avatar) in
 * step. `useUpdateMe` already refreshes the profile, feed and leaderboards. Nothing throws out of
 * the hook: a failure sets `error` and leaves the photo as it was.
 */
export function useAvatarUpload() {
  const upload = useUploadMedia();
  const update = useUpdateMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Each choose/remove bumps the generation, so a slow earlier call can't overwrite a newer one.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const uploadAsync = upload.mutateAsync;
  const updateAsync = update.mutateAsync;

  const syncSession = useCallback((profile: Profile) => {
    if (useSession.getState().status === 'ready') {
      const { handle, displayName, avatarUrl } = profile;
      useSession.getState().completeOnboarding({ handle, displayName, avatarUrl });
    }
  }, []);

  const choose = useCallback(async (): Promise<void> => {
    setError(undefined);
    let photo: PreparedPhoto | null = null;
    let started = false;
    // Taken once the person has picked: cancelling the picker leaves an upload in flight alone.
    let gen = generation.current;
    const live = () => mounted.current && gen === generation.current;
    try {
      const picked = await pickImage('library');
      if (!picked) return;
      gen = ++generation.current;
      if (!mounted.current) {
        revokeIfBlob(picked.uri);
        return;
      }
      started = true;
      setBusy(true);
      photo = await preparePhoto(picked, AVATAR_MAX_EDGE);
      const { assetId } = await uploadAsync({ kind: 'avatar', file: photo.blob, mimeType: photo.mimeType });
      const profile = await updateAsync({ avatarAssetId: assetId });
      if (mounted.current) syncSession(profile);
    } catch (e) {
      if (live()) setError(avatarError(e));
    } finally {
      // The server's URL is what gets displayed, never the local preview.
      revokeIfBlob(photo?.uri);
      if (started && live()) setBusy(false);
    }
  }, [uploadAsync, updateAsync, syncSession]);

  const remove = useCallback(async (): Promise<void> => {
    const gen = ++generation.current;
    const live = () => mounted.current && gen === generation.current;
    setError(undefined);
    setBusy(true);
    try {
      const profile = await updateAsync({ avatarAssetId: null });
      if (mounted.current) syncSession(profile);
    } catch (e) {
      if (live()) setError(avatarError(e));
    } finally {
      if (live()) setBusy(false);
    }
  }, [updateAsync, syncSession]);

  const clearError = useCallback(() => setError(undefined), []);

  return { busy, error, choose, remove, clearError };
}

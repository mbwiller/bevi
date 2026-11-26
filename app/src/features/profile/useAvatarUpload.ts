import { isApiError, type Profile } from '@bevi/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUpdateMe, useUploadMedia } from '@/api/hooks';
import {
  AVATAR_MAX_EDGE,
  AVATAR_SOURCE_MAX_EDGE,
  cropPhoto,
  isUnsupportedImage,
  pickImage,
  preparePhoto,
  revokeIfBlob,
  type CropSource,
  type PreparedPhoto,
} from '@/features/create-bev/photo';
import { formErrorMessage } from '@/features/auth/formError';
import type { PhotoCrop } from '@/lib/photoCrop';
import { useSession } from '@/state/session';

const UNSUPPORTED = "That image can't be used. Try a JPEG or PNG.";
const REJECTED = "Couldn't upload your photo. Try another one.";

function avatarError(e: unknown): string {
  if (isUnsupportedImage(e)) return UNSUPPORTED;
  if (isApiError(e) && e.code === 'validation') return REJECTED;
  return formErrorMessage(e);
}

/** The "Move and scale" step (`AvatarCropStep`): the photo to frame, or null when the step is closed. */
export interface AvatarCrop {
  photo: CropSource | null;
  /** "Use photo": the step closes and the framed square uploads. */
  confirm: (crop: PhotoCrop) => void;
  /** "Cancel" (or the modal's own close): nothing uploads and the photo stays as it was. */
  cancel: () => void;
}

/**
 * Sets or removes the signed-in person's profile photo (Edit profile, onboarding). A chosen photo
 * is picked and made into an upright JPEG working copy (`AVATAR_SOURCE_MAX_EDGE`), which `crop`
 * offers to the PhotoCropper; "Use photo" cuts the framed square out at `AVATAR_MAX_EDGE`
 * (`cropPhoto`), uploads it as an `avatar` asset and saves it with `updateMe({ avatarAssetId })`
 * straight away, and "Cancel" changes nothing. `busy` is true from the pick until the upload ends or
 * the step is cancelled. `remove()` clears the photo. Like
 * `useSaveDisplayName`, a finished change keeps the session store's profile (the tab-bar avatar) in
 * step. `useUpdateMe` already refreshes the profile, feed and leaderboards. Nothing throws out of
 * the hook: a failure sets `error` and leaves the photo as it was.
 */
export function useAvatarUpload() {
  const upload = useUploadMedia();
  const update = useUpdateMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [cropping, setCropping] = useState<CropSource | null>(null);
  // Each choose/remove bumps the generation, so a slow earlier call can't overwrite a newer one.
  const generation = useRef(0);
  const mounted = useRef(true);
  // The open crop step's answer: a square, or null for Cancel (and for anything that closes it).
  const answer = useRef<((crop: PhotoCrop | null) => void) | null>(null);

  /** Closes the crop step, if open, as a Cancel: the waiting `choose` then releases its photo. */
  const dismissCrop = useCallback(() => {
    const resolve = answer.current;
    answer.current = null;
    resolve?.(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dismissCrop();
    };
  }, [dismissCrop]);

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
    let working: PreparedPhoto | null = null;
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
      // A step still open from an earlier pick is closed: this photo replaces it.
      dismissCrop();
      started = true;
      setBusy(true);
      // Upright and EXIF-free; its size, not the picker's (which can be the unrotated one), is the truth.
      working = await preparePhoto(picked, AVATAR_SOURCE_MAX_EDGE);
      if (!live()) return;
      const source: CropSource = { uri: working.uri, width: working.width, height: working.height };
      const crop = await new Promise<PhotoCrop | null>((resolve) => {
        answer.current = resolve;
        setCropping(source);
      });
      if (mounted.current) setCropping((open) => (open === source ? null : open));
      if (!crop || !live()) return;
      photo = await cropPhoto(source, crop, AVATAR_MAX_EDGE);
      const { assetId } = await uploadAsync({ kind: 'avatar', file: photo.file, mimeType: photo.mimeType });
      const profile = await updateAsync({ avatarAssetId: assetId });
      if (mounted.current) syncSession(profile);
    } catch (e) {
      if (live()) setError(avatarError(e));
    } finally {
      // The server's URL is what gets displayed, never the local preview or the working copy.
      revokeIfBlob(working?.uri);
      revokeIfBlob(photo?.uri);
      if (started && live()) setBusy(false);
    }
  }, [uploadAsync, updateAsync, syncSession, dismissCrop]);

  const remove = useCallback(async (): Promise<void> => {
    const gen = ++generation.current;
    dismissCrop();
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
  }, [updateAsync, syncSession, dismissCrop]);

  const clearError = useCallback(() => setError(undefined), []);

  const confirm = useCallback((square: PhotoCrop) => {
    const resolve = answer.current;
    answer.current = null;
    // Closed at once; the AvatarPicker's spinner shows while the square is cut out and uploads.
    setCropping(null);
    resolve?.(square);
  }, []);
  const cancel = useCallback(() => {
    setCropping(null);
    dismissCrop();
  }, [dismissCrop]);
  const crop = useMemo<AvatarCrop>(() => ({ photo: cropping, confirm, cancel }), [cropping, confirm, cancel]);

  return { busy, error, choose, remove, clearError, crop };
}

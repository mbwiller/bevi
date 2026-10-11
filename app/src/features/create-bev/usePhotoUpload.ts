import type { UploadMediaInput, UploadMediaResult } from '@bevi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUploadMedia } from '@/api/hooks';

import { pickImage, preparePhoto, revokeIfBlob, type PhotoSource, type PreparedPhoto } from './photo';

export type PhotoPhase = 'empty' | 'preparing' | 'uploading' | 'uploaded' | 'failed';

export interface PhotoUploadState {
  phase: PhotoPhase;
  photo: PreparedPhoto | null;
  /** Set once the upload succeeded. */
  asset: UploadMediaResult | null;
  error: unknown;
}

const EMPTY: PhotoUploadState = { phase: 'empty', photo: null, asset: null, error: null };

/**
 * One photo slot of the wizard (the Bev photo or the nutrition label): pick → resize → upload in
 * the background as soon as it is chosen. Cancelling the picker leaves the slot as it was.
 * `ensureUploaded()` is what submit awaits: it waits for preparation, then returns the finished
 * asset id, the in-flight upload, or a fresh retry after a failure.
 *
 * The slot owns its preview's object URL: it is revoked when the photo is replaced or cleared and
 * when the slot unmounts.
 */
export function usePhotoUpload(kind: UploadMediaInput['kind']) {
  const upload = useUploadMedia();
  const uploadRef = useRef(upload.mutateAsync);
  uploadRef.current = upload.mutateAsync;
  const [state, setState] = useState<PhotoUploadState>(EMPTY);
  const stateRef = useRef(state);
  // Each choose/clear bumps the generation, so a slow upload of a replaced photo is ignored.
  const generation = useRef(0);
  const inflight = useRef<Promise<string> | null>(null);
  const preparing = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokeIfBlob(stateRef.current.photo?.uri);
    };
  }, []);

  const set = useCallback((next: PhotoUploadState) => {
    const prev = stateRef.current.photo?.uri;
    if (prev && prev !== next.photo?.uri) revokeIfBlob(prev);
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  const send = useCallback(
    (photo: PreparedPhoto, gen: number): Promise<string> => {
      set({ phase: 'uploading', photo, asset: null, error: null });
      const p = uploadRef
        .current({ kind, file: photo.blob, mimeType: photo.mimeType })
        .then((asset) => {
          if (gen === generation.current) set({ phase: 'uploaded', photo, asset, error: null });
          return asset.assetId;
        })
        .catch((error: unknown) => {
          if (gen === generation.current) set({ phase: 'failed', photo, asset: null, error });
          throw error;
        })
        .finally(() => {
          if (inflight.current === p) inflight.current = null;
        });
      inflight.current = p;
      p.catch(() => undefined); // The state carries the failure; submit re-raises it via ensureUploaded.
      return p;
    },
    [kind, set],
  );

  /** Opens the picker. Resolves false when the person cancelled (nothing changes). */
  const choose = useCallback(
    async (source: PhotoSource): Promise<boolean> => {
      const picked = await pickImage(source);
      if (!picked) return false;
      const gen = ++generation.current;
      inflight.current = null;
      set({ phase: 'preparing', photo: null, asset: null, error: null });
      const prep = (async () => {
        let photo: PreparedPhoto;
        try {
          photo = await preparePhoto(picked);
        } catch (error) {
          if (gen === generation.current) set({ phase: 'failed', photo: null, asset: null, error });
          return;
        }
        if (gen !== generation.current || !mounted.current) {
          revokeIfBlob(photo.uri); // Replaced or closed while preparing.
          return;
        }
        void send(photo, gen);
      })();
      preparing.current = prep;
      await prep;
      if (preparing.current === prep) preparing.current = null;
      return true;
    },
    [send, set],
  );

  /** Uploads the same photo again after a failure. */
  const retry = useCallback(() => {
    const { photo } = stateRef.current;
    if (photo) void send(photo, generation.current);
  }, [send]);

  /** The server lost the asset (`unknown_asset`): forget it so the next submit uploads again. */
  const invalidate = useCallback(() => {
    const { photo } = stateRef.current;
    if (photo) set({ phase: 'failed', photo, asset: null, error: null });
  }, [set]);

  const clear = useCallback(() => {
    generation.current++;
    inflight.current = null;
    preparing.current = null;
    set(EMPTY);
  }, [set]);

  /**
   * The asset id for `bevs.create`, waiting for preparation and uploading (again) if needed.
   * Rejects with the preparation error (`UnsupportedImageError`), the upload error, or `no_photo`.
   */
  const ensureUploaded = useCallback(async (): Promise<string> => {
    if (preparing.current) await preparing.current;
    const s = stateRef.current;
    if (s.phase === 'uploaded' && s.asset) return s.asset.assetId;
    if (inflight.current) return inflight.current;
    if (s.photo) return send(s.photo, generation.current);
    throw s.error ?? new Error('no_photo');
  }, [send]);

  return { ...state, choose, retry, clear, invalidate, ensureUploaded };
}

export type PhotoUpload = ReturnType<typeof usePhotoUpload>;

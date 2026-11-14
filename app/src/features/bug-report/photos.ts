import * as ImagePicker from 'expo-image-picker';

import { preparePhoto, type PreparedPhoto } from '@/features/create-bev/photo';

/**
 * Photos from the library for a note, several at once (BEV-8: the old form took one). The library
 * opens with multiple selection, capped at the note's free slots, and each pick is prepared the way
 * the create-Bev wizard prepares one (resized, re-encoded as JPEG, never uploaded untouched).
 * `failed` counts the picks that couldn't be read.
 */
export async function pickPhotos(limit: number): Promise<{ photos: PreparedPhoto[]; failed: number }> {
  if (limit <= 0) return { photos: [], failed: 0 };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return { photos: [], failed: 0 };
  const settled = await Promise.allSettled(result.assets.slice(0, limit).map((asset) => preparePhoto(asset)));
  const photos = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  return { photos, failed: settled.length - photos.length };
}

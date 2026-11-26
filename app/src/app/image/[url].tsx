import { useLocalSearchParams } from 'expo-router';

import { ImageViewer } from '@/features/bev/ImageViewer';
import { imageUrlFromParam } from '@/features/bev/imageUrl';
import { useBack } from '@/lib/useBack';

/**
 * Full-screen image viewer (§6.19): a Bev photo or nutrition label, over the page it was opened from.
 * `?shape=circle` (a profile photo) draws it round; anything else is the rectangle.
 */
export default function ImageScreen() {
  const back = useBack();
  const { url: param, shape } = useLocalSearchParams<{ url: string; shape?: string }>();
  return <ImageViewer url={imageUrlFromParam(param)} onClose={back} round={shape === 'circle'} />;
}

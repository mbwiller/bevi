import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { size, spacing, type, useTheme } from '@/theme';

import { PHOTO_HINT, UNREADABLE_IMAGE, UPLOAD_FAILED, UPLOADING_PHOTO } from './copy';
import type { PhotoSource } from './photo';
import type { PhotoUpload } from './usePhotoUpload';

/** One line under a photo: uploading, failed (with Retry), or nothing. */
export function PhotoStatusLine({ slot, failedText = UPLOAD_FAILED }: { slot: PhotoUpload; failedText?: string }) {
  const { colors } = useTheme();
  if (slot.phase === 'uploading' || slot.phase === 'preparing') {
    return (
      <Text style={[type.body, { color: colors.textSecondary }]} role="status" accessibilityLiveRegion="polite">
        {UPLOADING_PHOTO}
      </Text>
    );
  }
  if (slot.phase !== 'failed') return null;
  const unreadable = !slot.photo;
  return (
    <View style={styles.failed} role="alert">
      <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.scoreLow} />
      <Text style={[type.body, styles.flex, { color: colors.text }]}>{unreadable ? UNREADABLE_IMAGE : failedText}</Text>
      {unreadable ? null : (
        <Button variant="outlined" onPress={slot.retry} accessibilityLabel="Retry upload">
          Retry
        </Button>
      )}
    </View>
  );
}

export interface PhotoStepProps {
  slot: PhotoUpload;
  onPick: (source: PhotoSource) => void;
  error?: string;
}

/** Step 1: take or choose a photo of the Bev, preview it, retake. */
export function PhotoStep({ slot, onPick, error }: PhotoStepProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const preview = Math.min(width - spacing.gutter * 2, size.bevImageStrip * 2);
  const has = !!slot.photo;
  return (
    <View style={styles.body}>
      <Text style={[type.body, styles.center, { color: colors.textSecondary }]}>{PHOTO_HINT}</Text>
      <View style={styles.preview}>
        <BevImage
          size={preview}
          src={slot.photo?.uri}
          alt={has ? 'Your photo' : 'No photo yet'}
          status={slot.phase === 'preparing' ? 'loading' : 'ready'}
        />
      </View>
      <PhotoStatusLine slot={slot} />
      {error ? (
        <Text style={[type.body, { color: colors.scoreLow }]} role="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant={has ? 'outlined' : 'primary'} size="lg" block icon="camera" onPress={() => onPick('camera')}>
          {has ? 'Retake' : 'Take photo'}
        </Button>
        <Button variant="outlined" size="lg" block icon="image" onPress={() => onPick('library')}>
          {has ? 'Choose another' : 'Choose photo'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  center: { textAlign: 'center' },
  preview: { alignItems: 'center' },
  actions: { gap: spacing.md },
  failed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});

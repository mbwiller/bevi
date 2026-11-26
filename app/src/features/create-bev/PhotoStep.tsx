import { Linking, StyleSheet, Text, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useColumnWidth } from '@/lib/column';
import { size, spacing, type, useTheme } from '@/theme';

import { CAMERA_DENIED, OPEN_SETTINGS, OPEN_SETTINGS_LABEL, PHOTO_HINT, PICKER_FAILED, UNREADABLE_IMAGE, UPLOAD_FAILED, UPLOADING_PHOTO } from './copy';
import { isCameraPermissionDenied, type PhotoSource } from './photo';
import type { PhotoUpload } from './usePhotoUpload';

function openSettings() {
  void Linking.openSettings().catch(() => undefined);
}

/** The camera was refused, or the picker couldn't open: what to do about it. */
function PickErrorLine({ error }: { error: unknown }) {
  const { colors } = useTheme();
  const denied = isCameraPermissionDenied(error);
  return (
    <View style={styles.failed} role="alert">
      <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.scoreLow} />
      <Text style={[type.body, styles.flex, { color: colors.text }]}>{denied ? CAMERA_DENIED : PICKER_FAILED}</Text>
      {denied ? (
        <Button variant="outlined" onPress={openSettings} accessibilityLabel={OPEN_SETTINGS_LABEL}>
          {OPEN_SETTINGS}
        </Button>
      ) : null}
    </View>
  );
}

/** One line under a photo: the picker's failure (camera refused), uploading, failed (with Retry), or nothing. */
export function PhotoStatusLine({ slot, failedText = UPLOAD_FAILED }: { slot: PhotoUpload; failedText?: string }) {
  const { colors } = useTheme();
  const pickError = slot.pickError ? <PickErrorLine error={slot.pickError} /> : null;
  if (slot.phase === 'uploading' || slot.phase === 'preparing') {
    return (
      <>
        {pickError}
        <Text style={[type.body, { color: colors.textSecondary }]} role="status" accessibilityLiveRegion="polite">
          {UPLOADING_PHOTO}
        </Text>
      </>
    );
  }
  if (slot.phase !== 'failed') return pickError;
  const unreadable = !slot.photo;
  return (
    <>
      {pickError}
      <View style={styles.failed} role="alert">
        <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.scoreLow} />
        <Text style={[type.body, styles.flex, { color: colors.text }]}>{unreadable ? UNREADABLE_IMAGE : failedText}</Text>
        {unreadable ? null : (
          <Button variant="outlined" onPress={slot.retry} accessibilityLabel="Retry upload">
            Retry
          </Button>
        )}
      </View>
    </>
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
  // The column's width, not the window's: on a laptop the screen is the centred column (lib/column.ts).
  const width = useColumnWidth();
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

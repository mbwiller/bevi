import { useContext } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { PhotoCropper } from '@/components/PhotoCropper';
import { useTheme } from '@/theme';

import type { AvatarCrop } from './useAvatarUpload';

export interface AvatarCropStepProps {
  /** `useAvatarUpload().crop`. */
  crop: AvatarCrop;
}

/**
 * The "Move and scale" step of a new profile photo: a full-screen Modal over whatever is on screen
 * (Edit profile, the onboarding profile step) hosting the PhotoCropper, while `crop.photo` is set.
 * Inside a Sheet it must be one of the sheet's children: on iOS a Modal presents from the nearest
 * Modal above it, so it comes up over the sheet rather than under it. Closing it any other way
 * (the web's Escape) is a Cancel.
 */
export function AvatarCropStep({ crop }: AvatarCropStepProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext);
  const { photo, confirm, cancel } = crop;
  if (!photo) return null;
  return (
    <Modal
      visible
      transparent={false}
      presentationStyle="fullScreen"
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={cancel}
      // react-native-web renders the Modal's own wrapper as role="dialog"; name it too.
      {...({ 'aria-label': 'Move and scale' } as object)}
    >
      {/* iOS presents a Modal outside the app's root view, so gestures inside it need a root of their own. */}
      <GestureHandlerRootView style={styles.root}>
        <View
          testID="avatar-crop-step"
          style={[
            styles.root,
            {
              backgroundColor: colors.surface,
              paddingTop: insets?.top ?? 0,
              paddingBottom: insets?.bottom ?? 0,
              paddingLeft: insets?.left ?? 0,
              paddingRight: insets?.right ?? 0,
            },
          ]}
          // iOS: keep VoiceOver in the step, not the screen it covers.
          {...(Platform.OS === 'web' ? {} : { accessibilityViewIsModal: true })}
        >
          <PhotoCropper src={photo.uri} width={photo.width} height={photo.height} onDone={confirm} onCancel={cancel} />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

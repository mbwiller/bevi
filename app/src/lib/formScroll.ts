import { Platform, type ScrollViewProps } from 'react-native';

/**
 * Props for a ScrollView that holds a form (sign in, sign up, onboarding, settings, the create-Bev
 * wizard, the ranking note). `keyboardShouldPersistTaps="handled"`: with the keyboard up, a tap on a
 * button works at once instead of only dismissing the keyboard. `automaticallyAdjustKeyboardInsets`
 * (iOS): UIKit grows the content's bottom inset by what the keyboard covers and scrolls the focused
 * field into view, which also makes a short form scrollable while the keyboard is open. The web has no
 * such prop (the browser scrolls a focused field into view itself), so it gets only the first.
 */
export const FORM_SCROLL: Pick<ScrollViewProps, 'keyboardShouldPersistTaps' | 'automaticallyAdjustKeyboardInsets'> = {
  keyboardShouldPersistTaps: 'handled',
  ...(Platform.OS === 'web' ? {} : { automaticallyAdjustKeyboardInsets: true }),
};

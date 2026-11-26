import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether this device has been shown the ask before the iOS prompt (design system
// ScreenNotificationsAsk): once per device, whoever is signed in. AsyncStorage on the phone, as
// Recents (features/add-bev/recents.ts); askedFlag.web.ts answers "asked" (the web has no push).

export const ASKED_KEY = 'bevi.notifications.asked';

/** True once the ask has been shown here. A storage that cannot be read answers true: never nag. */
export async function wasAsked(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) === '1';
  } catch {
    return true;
  }
}

/** Remembers that the ask was shown. A failed write is dropped: at worst it is shown once more. */
export async function markAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Nothing to do.
  }
}

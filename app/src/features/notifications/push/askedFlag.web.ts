// The web has no push, so it never shows the ask (askedFlag.ts is the phone's flag).

export const ASKED_KEY = 'bevi.notifications.asked';

export async function wasAsked(): Promise<boolean> {
  return true;
}

export async function markAsked(): Promise<void> {}

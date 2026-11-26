import * as Haptics from 'expo-haptics';

// A small tap felt under the finger, for the few moments that should feel physical. This is the
// native file; the web one, haptics.web.ts, does nothing (no browser on iPhone exposes a Taptic Engine).

/** A light tick: a tab or segment changes. */
export function selectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** A soft bump: something is toggled on (a like). */
export function lightHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

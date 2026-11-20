import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Has VoiceOver say `text` when it appears or changes (an error under a form, "You're offline").
 * `accessibilityLiveRegion` is Android-only and `role="alert"` / `"status"` map to nothing on iOS, so
 * without this a status line is silent to a VoiceOver user. Re-renders with the same text say
 * nothing; empty, null and undefined say nothing. The web file (useAnnounce.web.ts) does nothing:
 * its `role` and `aria-live` attributes are real live regions there, and announcing too would say
 * each message twice.
 */
/**
 * Says `text` once, now: for something that happened (a scan filled in the form) rather than text
 * that is on screen. The hook above speaks when its text changes, which is wrong for that: the same
 * result twice would be silent, and a screen coming back would repeat an old one.
 */
export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibility(text);
}

export function useAnnounce(text: string | null | undefined): void {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

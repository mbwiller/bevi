import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share } from 'react-native';

/** How long "Link copied" stays up. */
const NOTICE_MS = 3000;

/** The web address of a profile: this site's origin + `/user/<id>`. Empty off the web. */
export function profileUrl(userId: string): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return `${window.location.origin}/user/${encodeURIComponent(userId)}`;
}

/**
 * Share profile (§6.13): copies the profile's URL to the clipboard on the web and returns a short
 * confirmation ("Link copied") for a polite live region, or what went wrong. Off the web it falls
 * back to the system share sheet. The link opens the profile for anyone signed in to Bevi.
 */
export function useShareProfile(userId: string | undefined) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((text: string) => {
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const share = useCallback(async () => {
    if (!userId) return;
    const url = profileUrl(userId);
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(url);
        show('Link copied');
      } catch {
        show(`Couldn't copy the link. It's ${url}`);
      }
      return;
    }
    try {
      await Share.share({ message: url });
    } catch {
      show("Couldn't open sharing. Try again.");
    }
  }, [userId, show]);

  return { share, notice };
}

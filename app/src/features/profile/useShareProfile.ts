import { useCallback, useEffect, useRef, useState } from 'react';

import { profileUrl, shareProfileLink } from './profileLink';

/** How long a notice ("Link copied", or what went wrong) stays up. */
const NOTICE_MS = 3000;

/**
 * Share profile (§6.13): hands over the profile's link and returns a short line for a polite live
 * region when there is one to show. On iOS the link opens the system share sheet; on the web it is
 * copied to the clipboard and the line is "Link copied" (profileLink.ts and profileLink.web.ts).
 * The link opens the profile for anyone signed in to Bevi.
 */
export function useShareProfile(userId: string | undefined) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const show = useCallback((text: string) => {
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const share = useCallback(async () => {
    if (!userId) return;
    const text = await shareProfileLink(profileUrl(userId));
    // The share sheet can stay open long after the person has left the screen.
    if (text && mounted.current) show(text);
  }, [userId, show]);

  return { share, notice };
}

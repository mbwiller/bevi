import { Share } from 'react-native';

import { WEB_ORIGIN } from '@/lib/webOrigin';

/**
 * A profile's link and how it is handed over. The native file: the link points at the web app
 * (`WEB_ORIGIN`), because the iOS app has no address of its own, and it goes to the system share
 * sheet. The web one (profileLink.web.ts) uses the page's own origin and the clipboard.
 */
export function profileUrl(userId: string): string {
  return `${WEB_ORIGIN}/user/${encodeURIComponent(userId)}`;
}

/**
 * Opens the share sheet with the link. Resolves with a line to show the person, or null when there
 * is nothing to say: the sheet is its own confirmation, and closing it without sharing is not an
 * error.
 */
export async function shareProfileLink(url: string): Promise<string | null> {
  try {
    // `url`, not `message`: iOS then treats it as a link (a preview in Messages, AirDrop opens it).
    await Share.share({ url });
    return null;
  } catch {
    return "Couldn't open sharing. Try again.";
  }
}

import { WEB_ORIGIN } from '@/lib/webOrigin';

/**
 * The web file: a profile's link is this site's own origin + `/user/<id>`, so a link copied on a
 * preview or on localhost points back at where it was copied, and it goes to the clipboard. The
 * native file, profileLink.ts, points at the web app and opens the share sheet.
 */
export function profileUrl(userId: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : WEB_ORIGIN;
  return `${origin}/user/${encodeURIComponent(userId)}`;
}

/** Copies the link. Resolves with the line to show: the confirmation, or the link itself to copy by hand. */
export async function shareProfileLink(url: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(url);
    return 'Link copied';
  } catch {
    return `Couldn't copy the link. It's ${url}`;
  }
}

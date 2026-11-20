/**
 * Runs `open` (a `Linking.openURL` call) and swallows its failure. The OS can refuse a URL (no app
 * to open it, a malformed link), and a floating `void Linking.openURL(url)` then becomes an unhandled
 * promise rejection. Nothing useful can be shown for it, so a refused link just does nothing.
 * Tolerates an `open` that throws or returns a non-promise.
 */
export function openLink(open: () => unknown): void {
  try {
    Promise.resolve(open()).catch(() => undefined);
  } catch {
    // opened synchronously and refused: nothing to do
  }
}

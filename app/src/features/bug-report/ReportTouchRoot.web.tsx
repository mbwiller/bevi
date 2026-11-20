import type { ReactNode } from 'react';

/**
 * The web file of ReportTouchRoot.tsx: nothing. On the web the reporter hears taps on `document`
 * (pickMode.web.ts, trail.web.ts), so the app's screens need nothing around them.
 */
export function ReportTouchRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

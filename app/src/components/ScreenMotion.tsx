import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MoveVariant } from './MoveScene';

export * from './MoveScene';

export interface StackSceneProps {
  variant: Exclude<MoveVariant, 'fade'>;
  /** Whether this screen arrives by a push. Unused on iOS: the native stack plays the transition. */
  enter: boolean;
  children: ReactNode;
}

/**
 * A screen of the root Stack, on iOS. No entrance of its own: the native stack already slides a
 * pushed screen in and rises a modal, so a JS entrance on top would play the movement twice and
 * show the screen blank inside the native one. `ScreenMotion.web.tsx` is the web file, where the
 * navigator has no transition of its own. Tab and People scenes (`TabScene`, in `MoveScene.tsx`)
 * are the same on both: the JS tab navigator has no transition either.
 *
 * A full-screen modal (`rise`) gets a safe-area provider of its own. UIKit presents it in a view
 * controller of its own, outside the app's root view, so the screen's native `SafeAreaView` finds
 * no provider above it. It then reads its own insets once, as it joins the window, which is while
 * the modal is still below the screen: zero on every edge, and nothing tells it when the modal has
 * landed (RNCSafeAreaViewComponentView: `findNearestProvider`, `didMoveToWindow`). The header was
 * drawn under the clock and the last button under the home indicator. A provider inside the modal
 * is a view UIKit does tell (`safeAreaInsetsDidChange`), and it passes that on. It starts from the
 * app's insets, so the screen is never held back for a measurement.
 */
export function StackScene({ variant, children }: StackSceneProps) {
  if (variant === 'rise') return <SafeAreaProvider>{children}</SafeAreaProvider>;
  return <>{children}</>;
}

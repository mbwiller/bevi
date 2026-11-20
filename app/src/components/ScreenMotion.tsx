import type { ReactNode } from 'react';

import type { MoveVariant } from './MoveScene';

export * from './MoveScene';

export interface StackSceneProps {
  variant: Exclude<MoveVariant, 'fade'>;
  /** Whether this screen arrives by a push. Unused on iOS: the native stack plays the transition. */
  enter: boolean;
  children: ReactNode;
}

/**
 * A screen of the root Stack, on iOS: a passthrough. The native stack already slides a pushed
 * screen in and rises a modal, so a JS entrance on top would play the movement twice and show the
 * screen blank inside the native one. `ScreenMotion.web.tsx` is the web file, where the navigator
 * has no transition of its own. Tab and People scenes (`TabScene`, in `MoveScene.tsx`) are the same
 * on both: the JS tab navigator has no transition either.
 */
export function StackScene({ children }: StackSceneProps) {
  return <>{children}</>;
}

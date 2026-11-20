import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { MoveView, play, type MoveVariant } from './MoveScene';

export * from './MoveScene';

export interface StackSceneProps {
  variant: Exclude<MoveVariant, 'fade'>;
  /**
   * Whether this screen arrives by a push (true) or was there from the start (false: the app's
   * first screen, a deep link, a status change). Read once, on mount.
   */
  enter: boolean;
  children: ReactNode;
}

/**
 * A screen of the root Stack. On the web the navigator draws every screen in its stack and shows
 * only the top one (`display: none` for the rest), with no transition of its own, so the screen's
 * entrance is played here, once, when it mounts. Going back unmounts the top screen and shows the
 * one underneath exactly as it was: nothing replays and no frame is blank. The browser's history is
 * the router's; this only draws.
 */
export function StackScene({ variant, enter, children }: StackSceneProps) {
  const [entering] = useState(enter);
  const progress = useSharedValue(entering ? 0 : 1);
  useLayoutEffect(() => {
    if (entering) play(progress, variant);
    // Mount only: a later render (the Stack re-renders on every navigation) never replays it.
  }, []);
  return (
    <MoveView progress={progress} variant={variant}>
      {children}
    </MoveView>
  );
}

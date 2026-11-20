import { useRef, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { TAP_SLOP, useTouchRoot, type AppTouch, type TouchListener } from './touchRoot';

/**
 * The View around the app's screens that lets the reporter hear touches on iOS (touchRoot.ts says
 * why; ReportTouchRoot.web.tsx is the web file, which draws nothing). The root layout mounts it for
 * every account, so it is always the same one View and, unless the reporter has asked for
 * something, it has no handlers.
 *
 * Touches reach it from anywhere below it in React's tree, wherever UIKit draws them: a screen the
 * native stack presents as a full-screen modal and a `Modal` (the app's Sheet) are both descendants
 * here. The reporter's own layer and sheets are not (they are drawn beside it), so a touch on the
 * reporter is never heard.
 *
 * Select mode takes the touch in the capture phase (`onStartShouldSetResponderCapture`), which
 * makes this View the responder, so nothing under it is pressed. It also means nothing under it
 * scrolls: on iOS a scroll view does not scroll while a view above it is the responder
 * (RCTScrollViewComponentView, `_shouldDisableScrollInteraction`), so a tester scrolls to the thing
 * first and selects it then. A finger that travelled is still not a tap. A step recording only
 * watches (`onTouchStartCapture` and `onTouchEndCapture`), and the app gets the touch as usual,
 * scrolling included.
 *
 * Every value is read from the event before its handler returns: React Native empties the event
 * after that (the lesson of BEV-35).
 */

interface Down extends AppTouch {
  drifted: boolean;
}

function touchOf(event: GestureResponderEvent): AppTouch {
  const { pageX, pageY } = event.nativeEvent;
  return { target: event.target, x: pageX, y: pageY };
}

const far = (a: AppTouch, b: AppTouch): boolean => Math.hypot(a.x - b.x, a.y - b.y) > TAP_SLOP;

/** A listener's own error is its own: it never reaches the app's touch handling. */
function tell(run: () => void): void {
  try {
    run();
  } catch {
    // Nothing to do.
  }
}

export function ReportTouchRoot({ children }: { children: ReactNode }) {
  const select = useTouchRoot((s) => s.select);
  const steps = useTouchRoot((s) => s.steps);
  const down = useRef<Down | null>(null);

  const begin = (listener: TouchListener, event: GestureResponderEvent): void => {
    const touch = touchOf(event);
    // A second finger makes it a pinch, not a tap.
    const second = event.nativeEvent.touches.length > 1;
    down.current = { ...touch, drifted: second };
    if (second) tell(() => listener.onDrift?.());
    else tell(() => listener.onDown?.(touch));
  };
  const move = (listener: TouchListener, event: GestureResponderEvent): void => {
    const start = down.current;
    if (!start || start.drifted || !far(start, touchOf(event))) return;
    start.drifted = true;
    tell(() => listener.onDrift?.());
  };
  const end = (listener: TouchListener, event: GestureResponderEvent): void => {
    const start = down.current;
    const up = touchOf(event);
    down.current = null;
    if (!start) return;
    if (start.drifted || far(start, up)) tell(() => listener.onDrift?.());
    // The tap is on what the finger landed on, where it lifted.
    else tell(() => listener.onTap({ target: start.target, x: up.x, y: up.y }));
  };
  const cancel = (listener: TouchListener): void => {
    down.current = null;
    tell(() => listener.onDrift?.());
  };

  const handlers = select
    ? {
        onStartShouldSetResponderCapture: (event: GestureResponderEvent) => {
          begin(select, event);
          return true;
        },
        onResponderMove: (event: GestureResponderEvent) => move(select, event),
        onResponderRelease: (event: GestureResponderEvent) => end(select, event),
        onResponderTerminate: () => cancel(select),
        onResponderTerminationRequest: () => true,
      }
    : steps
      ? {
          onTouchStartCapture: (event: GestureResponderEvent) => begin(steps, event),
          onTouchMove: (event: GestureResponderEvent) => move(steps, event),
          onTouchEndCapture: (event: GestureResponderEvent) => end(steps, event),
          onTouchCancel: () => cancel(steps),
        }
      : null;

  return (
    <View style={styles.fill} collapsable={false} testID="report-touch-root" {...handlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

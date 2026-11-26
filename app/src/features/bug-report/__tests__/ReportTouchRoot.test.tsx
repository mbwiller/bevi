import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ReportTouchRoot } from '../ReportTouchRoot';
import { ReportTouchRoot as WebTouchRoot } from '../ReportTouchRoot.web';
import { setTouchListener, useTouchRoot, type AppTouch, type TouchListener } from '../touchRoot';

// The View around the app's screens that the reporter hears touches through on iOS. jest has no
// touches of its own, so each handler is called the way React Native calls it: with an event that
// is emptied as soon as the handler returns.

type Handler = (event: unknown) => unknown;
type Props = Record<string, Handler | undefined>;

const VIEW = { node: 'the view under the finger' };

/** A touch event at a point, as React Native hands it over. */
function touch(x: number, y: number, fingers = 1) {
  return { target: VIEW, nativeEvent: { pageX: x, pageY: y, touches: Array.from({ length: fingers }, () => ({})) } as object | null };
}

/** Calls a handler and empties its event afterwards, as React Native does. */
function fire(handler: Handler | undefined, event: ReturnType<typeof touch>): unknown {
  expect(handler).toBeInstanceOf(Function);
  const answer = handler!(event);
  event.nativeEvent = null;
  return answer;
}

function listener(): TouchListener & { taps: AppTouch[]; downs: AppTouch[]; drifts: number } {
  const heard = {
    taps: [] as AppTouch[],
    downs: [] as AppTouch[],
    drifts: 0,
    onDown: (t: AppTouch) => void heard.downs.push(t),
    onDrift: () => void (heard.drifts += 1),
    onTap: (t: AppTouch) => void heard.taps.push(t),
  };
  return heard;
}

async function mount() {
  await render(
    <ReportTouchRoot>
      <Text>the app</Text>
    </ReportTouchRoot>,
  );
  return (): Props => screen.getByTestId('report-touch-root').props as Props;
}

/** Sets a listener and lets the View render with its handlers. */
async function listen(kind: 'select' | 'steps', next: TouchListener | null) {
  await act(async () => setTouchListener(kind, next));
}

beforeEach(() => useTouchRoot.setState({ select: null, steps: null }));

describe('with nothing asked of it', () => {
  it('is one plain View around the app, with no touch handler at all', async () => {
    const props = await mount();
    expect(screen.getByText('the app')).toBeTruthy();
    const handlers = Object.keys(props()).filter((key) => key.startsWith('on'));
    expect(handlers).toEqual([]);
  });

  it('draws nothing of its own on the web', async () => {
    await render(
      <WebTouchRoot>
        <Text>the app</Text>
      </WebTouchRoot>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByTestId('report-touch-root')).toBeNull();
  });
});

describe('select mode', () => {
  it('takes the touch from the app, says what the finger landed on, and reports a tap where it lifts', async () => {
    const props = await mount();
    const heard = listener();
    await listen('select', heard);

    // Taking the touch in the capture phase is what keeps every Pressable under it from being pressed.
    expect(fire(props().onStartShouldSetResponderCapture, touch(100, 300))).toBe(true);
    expect(heard.downs).toEqual([{ target: VIEW, x: 100, y: 300 }]);

    fire(props().onResponderRelease, touch(103, 302));
    expect(heard.taps).toEqual([{ target: VIEW, x: 103, y: 302 }]);
    expect(heard.drifts).toBe(0);
  });

  it('a finger that travelled is a scroll, not a tap', async () => {
    const props = await mount();
    const heard = listener();
    await listen('select', heard);

    fire(props().onStartShouldSetResponderCapture, touch(100, 300));
    fire(props().onResponderMove, touch(100, 340));
    fire(props().onResponderMove, touch(100, 380));
    fire(props().onResponderRelease, touch(100, 300));
    expect(heard.taps).toEqual([]);
    // Said once when it left, and again when it lifted without tapping.
    expect(heard.drifts).toBe(2);
  });

  it('a touch a scroll view took away, and a second finger, select nothing', async () => {
    const props = await mount();
    const heard = listener();
    await listen('select', heard);

    fire(props().onStartShouldSetResponderCapture, touch(100, 300));
    // UIKit's scroll gesture may always have the touch.
    expect(props().onResponderTerminationRequest!(undefined)).toBe(true);
    props().onResponderTerminate!(undefined);
    fire(props().onResponderRelease, touch(100, 300));

    fire(props().onStartShouldSetResponderCapture, touch(100, 300, 2));
    fire(props().onResponderRelease, touch(100, 300));
    expect(heard.taps).toEqual([]);
    expect(heard.downs).toHaveLength(1);
  });

  it('a listener that throws costs nothing but its own answer', async () => {
    const props = await mount();
    await listen('select', {
      onDown: () => {
        throw new Error('the reporter broke');
      },
      onTap: () => {
        throw new Error('again');
      },
    });
    expect(fire(props().onStartShouldSetResponderCapture, touch(1, 1))).toBe(true);
    expect(() => fire(props().onResponderRelease, touch(1, 1))).not.toThrow();
  });

  it('lets go of every handler when it is turned off', async () => {
    const props = await mount();
    const heard = listener();
    await listen('select', heard);
    expect(props().onStartShouldSetResponderCapture).toBeInstanceOf(Function);
    await listen('select', null);
    expect(Object.keys(props()).filter((key) => key.startsWith('on'))).toEqual([]);
  });
});

describe('a step recording', () => {
  it('only watches: a tap is heard, and the touch is never taken from the app', async () => {
    const props = await mount();
    const heard = listener();
    await listen('steps', heard);

    expect(props().onStartShouldSetResponderCapture).toBeUndefined();
    fire(props().onTouchStartCapture, touch(40, 800));
    fire(props().onTouchEndCapture, touch(41, 801));
    expect(heard.taps).toEqual([{ target: VIEW, x: 41, y: 801 }]);
  });

  it('does not hear a scroll or a cancelled touch as a tap', async () => {
    const props = await mount();
    const heard = listener();
    await listen('steps', heard);

    fire(props().onTouchStartCapture, touch(40, 400));
    fire(props().onTouchMove, touch(40, 300));
    fire(props().onTouchEndCapture, touch(40, 300));

    fire(props().onTouchStartCapture, touch(40, 400));
    props().onTouchCancel!(undefined);
    fire(props().onTouchEndCapture, touch(40, 400));
    expect(heard.taps).toEqual([]);
  });

  it('steps aside for select mode while both are on', async () => {
    const props = await mount();
    const steps = listener();
    const select = listener();
    await listen('steps', steps);
    await listen('select', select);

    expect(props().onTouchStartCapture).toBeUndefined();
    fire(props().onStartShouldSetResponderCapture, touch(10, 10));
    fire(props().onResponderRelease, touch(10, 10));
    expect(select.taps).toHaveLength(1);
    expect(steps.taps).toEqual([]);
  });
});

describe('setTouchListener', () => {
  it('clears a listener only for whoever set it', () => {
    const first = listener();
    const second = listener();
    setTouchListener('select', first);
    setTouchListener('select', second);
    // The first one's stop arrives late: the second stays.
    setTouchListener('select', null, first);
    expect(useTouchRoot.getState().select).toBe(second);
    setTouchListener('select', null, second);
    expect(useTouchRoot.getState().select).toBeNull();
  });
});

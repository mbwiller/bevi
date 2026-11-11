import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, Text, type ScaledSize } from 'react-native';

import { motion } from '@/theme';

import { PUSH_SHIFT, RISE_SHIFT, StackScene, TabScene, type TabHistory } from '../ScreenMotion';

let mockReduced = false;
const mockWorklets: (() => Record<string, unknown>)[] = [];
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return {
    ...mock,
    useReducedMotion: () => mockReduced,
    useAnimatedStyle: (worklet: () => Record<string, unknown>) => {
      mockWorklets.push(worklet);
      return worklet();
    },
    withTiming: jest.fn((to: number) => to),
  };
});
const { withTiming } = jest.requireMock('react-native-reanimated') as { withTiming: jest.Mock };

beforeEach(() => {
  mockReduced = false;
  withTiming.mockClear();
});

/** The durations of the entrances played so far. */
const played = () => withTiming.mock.calls.map(([, config]) => (config as { duration: number }).duration);
/** The scene's pose as first painted (the mock evaluates the style once per render). */
const pose = () => screen.getByTestId('screen-move');

/** A phone in portrait, and a desktop window where the app is the centred 480pt column. */
const PHONE = { width: 393, height: 852 };
const DESKTOP = { width: 1440, height: 900 };
let saved: { window: ScaledSize; screen: ScaledSize };
function windowOf(size: { width: number; height: number }) {
  const d = { ...size, scale: 2, fontScale: 1 };
  Dimensions.set({ window: d, screen: d });
}
beforeEach(() => {
  saved = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  windowOf(PHONE);
});
afterEach(() => Dimensions.set(saved));

describe('StackScene', () => {
  it('a pushed screen slides in from 22% of the width, fading in, over motion.base, once', async () => {
    const { rerender } = await render(
      <StackScene variant="push" enter>
        <Text>Bev</Text>
      </StackScene>,
    );
    expect(pose()).toHaveStyle({ opacity: 0, transform: [{ translateX: PHONE.width * PUSH_SHIFT }, { translateY: 0 }] });
    expect(PUSH_SHIFT).toBe(0.22);
    expect(played()).toEqual([motion.base]);
    // The Stack re-renders it on every navigation: nothing replays.
    await rerender(
      <StackScene variant="push" enter>
        <Text>Bev</Text>
      </StackScene>,
    );
    expect(played()).toEqual([motion.base]);
  });

  it("on a wide window the push takes 22% of the 480pt column, not of the window", async () => {
    windowOf(DESKTOP);
    await render(
      <StackScene variant="push" enter>
        <Text>Bev</Text>
      </StackScene>,
    );
    expect(pose()).toHaveStyle({ opacity: 0, transform: [{ translateX: 0.22 * 480 }, { translateY: 0 }] });
  });

  it('a full-screen modal rises by 8% of the height instead; the column is the full height, on a wide window too', async () => {
    await render(
      <StackScene variant="rise" enter>
        <Text>Rank</Text>
      </StackScene>,
    );
    expect(pose()).toHaveStyle({ opacity: 0, transform: [{ translateX: 0 }, { translateY: PHONE.height * RISE_SHIFT }] });
    expect(RISE_SHIFT).toBe(0.08);
    expect(played()).toEqual([motion.base]);
    await act(async () => windowOf(DESKTOP));
    await render(
      <StackScene variant="rise" enter>
        <Text>Rank</Text>
      </StackScene>,
    );
    expect(screen.getAllByTestId('screen-move').at(-1)).toHaveStyle({ transform: [{ translateX: 0 }, { translateY: DESKTOP.height * RISE_SHIFT }] });
  });

  it('once the entrance has played, the screen carries no transform', async () => {
    await render(
      <StackScene variant="push" enter>
        <Text>Bev</Text>
      </StackScene>,
    );
    // The mount's worklet, read again after the entrance ran to 1.
    expect(mockWorklets.at(-1)!()).toEqual({ opacity: 1, transform: [] });
  });

  it('the screens the Stack starts with just show, with no transform', async () => {
    await render(
      <StackScene variant="push" enter={false}>
        <Text>Feed</Text>
      </StackScene>,
    );
    expect(pose()).toHaveStyle({ opacity: 1, transform: [] });
    expect(played()).toEqual([]);
  });

  it('a screen that mounted in place never plays later, even if its props change', async () => {
    const { rerender } = await render(
      <StackScene variant="push" enter={false}>
        <Text>Feed</Text>
      </StackScene>,
    );
    await rerender(
      <StackScene variant="push" enter>
        <Text>Feed</Text>
      </StackScene>,
    );
    expect(played()).toEqual([]);
  });

  it('under Reduce Motion a push and a rise are fades only, with no transform', async () => {
    mockReduced = true;
    await render(
      <StackScene variant="push" enter>
        <Text>Bev</Text>
      </StackScene>,
    );
    expect(pose()).toHaveStyle({ opacity: 0, transform: [] });
    expect(played()).toEqual([motion.base]);
  });
});

describe('TabScene', () => {
  type Name = 'feed' | 'lists' | 'people';
  /** The tab navigator's scenes, with `current` the one showing. People is the pushed one. */
  function Tabs({ current, history, mounted }: { current: Name; history: TabHistory; mounted: Name[] }) {
    return (
      <>
        {mounted.map((name) => (
          <TabScene key={name} name={name} variant={name === 'people' ? 'push' : 'fade'} active={name === current} history={history}>
            <Text>{name}</Text>
          </TabScene>
        ))}
      </>
    );
  }

  it('the first tab at launch just shows', async () => {
    await render(<Tabs current="feed" mounted={['feed']} history={{ current: null }} />);
    expect(played()).toEqual([]);
  });

  it('switching tabs fades the new one in over motion.fast, also a tab already visited', async () => {
    const history: TabHistory = { current: null };
    const { rerender } = await render(<Tabs current="feed" mounted={['feed']} history={history} />);
    await rerender(<Tabs current="lists" mounted={['feed', 'lists']} history={history} />);
    expect(played()).toEqual([motion.fast]);
    await rerender(<Tabs current="feed" mounted={['feed', 'lists']} history={history} />);
    expect(played()).toEqual([motion.fast, motion.fast]);
  });

  it('the newly mounted tab paints its start pose: transparent, in place', async () => {
    const history: TabHistory = { current: null };
    const { rerender } = await render(<Tabs current="feed" mounted={['feed']} history={history} />);
    await rerender(<Tabs current="lists" mounted={['feed', 'lists']} history={history} />);
    expect(screen.getByText('lists').parent!).toHaveStyle({ opacity: 0, transform: [] });
  });

  it('People slides in like a pushed screen, and leaving it for the Feed is going back: nothing plays', async () => {
    const history: TabHistory = { current: null };
    const { rerender } = await render(<Tabs current="feed" mounted={['feed']} history={history} />);
    await rerender(<Tabs current="people" mounted={['feed', 'people']} history={history} />);
    expect(played()).toEqual([motion.base]);
    await rerender(<Tabs current="feed" mounted={['feed', 'people']} history={history} />);
    expect(played()).toEqual([motion.base]);
  });

  it('a re-render that keeps the same tab replays nothing', async () => {
    const history: TabHistory = { current: null };
    const { rerender } = await render(<Tabs current="feed" mounted={['feed']} history={history} />);
    await rerender(<Tabs current="lists" mounted={['feed', 'lists']} history={history} />);
    await rerender(<Tabs current="lists" mounted={['feed', 'lists']} history={history} />);
    expect(played()).toEqual([motion.fast]);
  });
});

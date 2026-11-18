import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedTransparency } from '../glass';
import { useReducedTransparency as useReducedTransparencyWeb } from '../glass.web';

// Jest resolves as iOS, so '../glass' is the native file; the web one is imported by name.

describe('native (AccessibilityInfo)', () => {
  const isEnabled = AccessibilityInfo.isReduceTransparencyEnabled as jest.Mock;
  const addEventListener = AccessibilityInfo.addEventListener as jest.Mock;
  let listener: ((on: boolean) => void) | undefined;
  let remove: jest.Mock;

  beforeEach(() => {
    listener = undefined;
    remove = jest.fn();
    addEventListener.mockImplementation((event: string, l: (on: boolean) => void) => {
      if (event === 'reduceTransparencyChanged') listener = l;
      return { remove };
    });
  });

  afterEach(() => {
    isEnabled.mockReset().mockImplementation(() => Promise.resolve(false));
    addEventListener.mockReset().mockImplementation(() => ({ remove: jest.fn() }));
  });

  it('reads the setting, then follows its change event, and unsubscribes on unmount', async () => {
    isEnabled.mockResolvedValue(true);
    const { result, unmount } = await renderHook(() => useReducedTransparency());
    expect(result.current).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith('reduceTransparencyChanged', expect.any(Function));

    await act(async () => listener!(false));
    expect(result.current).toBe(false);
    await act(async () => listener!(true));
    expect(result.current).toBe(true);

    await act(async () => unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('is off while the first answer is pending, and a change that beats it wins', async () => {
    let answer: (on: boolean) => void = () => {};
    isEnabled.mockReturnValue(new Promise<boolean>((r) => (answer = r)));
    const { result } = await renderHook(() => useReducedTransparency());
    expect(result.current).toBe(false);
    await act(async () => listener!(true));
    await act(async () => answer(false));
    expect(result.current).toBe(true);
  });
});

describe('web (prefers-reduced-transparency)', () => {
  const g = globalThis as { window?: { matchMedia?: unknown } };
  let saved: unknown;

  beforeEach(() => {
    g.window ??= {};
    saved = g.window.matchMedia;
  });
  afterEach(() => {
    g.window!.matchMedia = saved;
  });

  it('follows the media query', async () => {
    let change: (() => void) | undefined;
    const mq = {
      matches: true,
      addEventListener: jest.fn((_: string, l: () => void) => (change = l)),
      removeEventListener: jest.fn(),
    };
    const matchMedia = jest.fn(() => mq);
    g.window!.matchMedia = matchMedia;
    const { result, unmount } = await renderHook(() => useReducedTransparencyWeb());
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-transparency: reduce)');
    expect(result.current).toBe(true);
    mq.matches = false;
    await act(async () => change!());
    expect(result.current).toBe(false);
    await act(async () => unmount());
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', change);
  });

  it('is off where there is no matchMedia', async () => {
    g.window!.matchMedia = undefined;
    const { result } = await renderHook(() => useReducedTransparencyWeb());
    expect(result.current).toBe(false);
  });
});

import { act, renderHook } from '@testing-library/react-native';
import { Share } from 'react-native';

import { WEB_ORIGIN } from '@/lib/webOrigin';

import { useShareProfile } from '../useShareProfile';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shares a real link on iOS (it used to share an empty string)', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  const { result } = await renderHook(() => useShareProfile('user-1'));
  await act(() => result.current.share());
  expect(share).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenCalledWith({ url: `${WEB_ORIGIN}/user/user-1` });
  expect(result.current.notice).toBeNull();
});

it('does nothing until it knows whose profile it is', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  const { result } = await renderHook(() => useShareProfile(undefined));
  await act(() => result.current.share());
  expect(share).not.toHaveBeenCalled();
});

it('shows what went wrong for three seconds', async () => {
  jest.useFakeTimers();
  jest.spyOn(Share, 'share').mockRejectedValue(new Error('no sheet'));
  const { result } = await renderHook(() => useShareProfile('user-1'));
  await act(() => result.current.share());
  expect(result.current.notice).toBe("Couldn't open sharing. Try again.");
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(result.current.notice).toBeNull();
});

import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useAnnounce } from '../useAnnounce';
import { useAnnounce as useAnnounceOnWeb } from '../useAnnounce.web';

// Jest resolves as iOS, so `../useAnnounce` is the native hook; the web one is imported by name.
const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});

beforeEach(() => announce.mockClear());

it('announces text when it appears, once however often the component re-renders', async () => {
  const { rerender } = await renderHook((p: { text?: string | null }) => useAnnounce(p.text), { initialProps: { text: undefined } });
  expect(announce).not.toHaveBeenCalled();
  await rerender({ text: "That handle is taken." });
  await rerender({ text: "That handle is taken." });
  await rerender({ text: "That handle is taken." });
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('That handle is taken.');
});

it('announces again when the text changes, and not when it clears', async () => {
  const { rerender } = await renderHook((p: { text?: string | null }) => useAnnounce(p.text), { initialProps: { text: 'First' } });
  expect(announce).toHaveBeenLastCalledWith('First');
  await rerender({ text: 'Second' });
  expect(announce).toHaveBeenLastCalledWith('Second');
  await rerender({ text: null });
  await rerender({ text: '' });
  expect(announce).toHaveBeenCalledTimes(2);
});

it('is silent on the web, whose live regions already announce', async () => {
  await renderHook(() => useAnnounceOnWeb('Wrong password.'));
  expect(announce).not.toHaveBeenCalled();
});

import { Share } from 'react-native';

import { WEB_ORIGIN } from '@/lib/webOrigin';

import { profileUrl, shareProfileLink } from '../profileLink';

// Jest resolves as iOS, so this is the native file; the web one is covered in profileLink.web.test.ts.

afterEach(() => {
  jest.restoreAllMocks();
});

it('links to the profile on the web app, never an empty string', () => {
  expect(WEB_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
  expect(profileUrl('user-1')).toBe(`${WEB_ORIGIN}/user/user-1`);
  expect(profileUrl('a/b c')).toBe(`${WEB_ORIGIN}/user/a%2Fb%20c`);
});

it('opens the share sheet with the link as a URL and has nothing more to say', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await expect(shareProfileLink(profileUrl('user-1'))).resolves.toBeNull();
  expect(share).toHaveBeenCalledWith({ url: `${WEB_ORIGIN}/user/user-1` });
});

it('closing the sheet without sharing is not an error', async () => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
  await expect(shareProfileLink(profileUrl('user-1'))).resolves.toBeNull();
});

it('says so when the sheet cannot open', async () => {
  jest.spyOn(Share, 'share').mockRejectedValue(new Error('no sheet'));
  await expect(shareProfileLink(profileUrl('user-1'))).resolves.toBe("Couldn't open sharing. Try again.");
});

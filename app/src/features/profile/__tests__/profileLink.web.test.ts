import { WEB_ORIGIN } from '@/lib/webOrigin';

import { profileUrl, shareProfileLink } from '../profileLink.web';

// The web file, imported by name: jest resolves `../profileLink` as iOS (profileLink.test.ts).

const g = globalThis as unknown as { window?: { location?: { origin?: string } }; navigator?: { clipboard?: { writeText: jest.Mock } } };
const realWindow = g.window;
const realNavigator = g.navigator;

afterEach(() => {
  g.window = realWindow;
  g.navigator = realNavigator;
});

it("uses the page's own origin, so a link copied on localhost points back at localhost", () => {
  g.window = { location: { origin: 'http://localhost:8081' } };
  expect(profileUrl('user-1')).toBe('http://localhost:8081/user/user-1');
  expect(profileUrl('a/b c')).toBe('http://localhost:8081/user/a%2Fb%20c');
});

it('falls back to the web app when there is no page to ask', () => {
  g.window = undefined;
  expect(profileUrl('user-1')).toBe(`${WEB_ORIGIN}/user/user-1`);
});

it('copies the link and confirms it', async () => {
  const writeText = jest.fn(async () => undefined);
  g.navigator = { clipboard: { writeText } };
  await expect(shareProfileLink('http://localhost:8081/user/user-1')).resolves.toBe('Link copied');
  expect(writeText).toHaveBeenCalledWith('http://localhost:8081/user/user-1');
});

it('shows the link itself when the clipboard refuses', async () => {
  g.navigator = { clipboard: { writeText: jest.fn(async () => Promise.reject(new Error('denied'))) } };
  await expect(shareProfileLink('http://localhost:8081/user/user-1')).resolves.toBe("Couldn't copy the link. It's http://localhost:8081/user/user-1");
});

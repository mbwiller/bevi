import { openLink } from '../openLink';

it('calls the opener at once', () => {
  const open = jest.fn().mockResolvedValue(true);
  openLink(open);
  expect(open).toHaveBeenCalledTimes(1);
});

it('swallows a rejection, a throw and a non-promise return', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  openLink(() => Promise.reject(new Error('no app can open this')));
  openLink(() => {
    throw new Error('refused');
  });
  openLink(() => undefined);
  // Let any unhandled rejection surface (they are reported after the microtask queue drains).
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});

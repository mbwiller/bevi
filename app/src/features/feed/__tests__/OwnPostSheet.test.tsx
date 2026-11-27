// The More menu on your own post (TICKET-32): Delete post, a confirm, and what a failed delete says.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FeedItem } from '@bevi/shared';

import { api } from '@/api/client';
import { ME, controls } from '@/testing/fakeApi';

import { DELETE_BODY, DELETE_POST, DELETE_TITLE, OwnPostSheet } from '../OwnPostSheet';

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

async function ownPost(): Promise<FeedItem> {
  const me = await api.profile.getMe();
  return (await api.feed.listUser(me.id, { limit: 20 })).items[0]!;
}

async function renderSheet(post: FeedItem) {
  const onClose = jest.fn();
  const onDeleted = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <OwnPostSheet post={post} onClose={onClose} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onClose, onDeleted };
}

it('asks before deleting, and Delete removes that Bev and closes', async () => {
  const post = await ownPost();
  const spy = jest.spyOn(api.rankings, 'removeRanking');
  const { onClose } = await renderSheet(post);

  await fireEvent.press(screen.getByRole('button', { name: DELETE_POST }));
  expect(screen.getByText(DELETE_TITLE)).toBeTruthy();
  expect(screen.getByText(DELETE_BODY)).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: `Delete ${post.bev.name}` }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(spy).toHaveBeenCalledWith(post.bev.id);
});

it('a failed delete says so and keeps the sheet open on the confirm', async () => {
  const post = await ownPost();
  controls.failNext('network', 'rankings.removeRanking');
  const { onClose } = await renderSheet(post);

  await fireEvent.press(screen.getByRole('button', { name: DELETE_POST }));
  await fireEvent.press(screen.getByRole('button', { name: `Delete ${post.bev.name}` }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(DELETE_TITLE)).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect((await api.rankings.listMine()).items.some((r) => r.bevId === post.bev.id)).toBe(true);
});

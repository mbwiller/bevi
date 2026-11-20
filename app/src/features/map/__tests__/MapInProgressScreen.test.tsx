import path from 'path';

import { renderRouter, screen } from 'expo-router/testing-library';

import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { MAP_IN_PROGRESS_BODY, MAP_IN_PROGRESS_TITLE } from '../MapInProgressScreen';

const APP_DIR = path.resolve(__dirname, '../../../app');

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(() => controls.resetToFixtures());

it('the Map tab says the map is in progress, under its Map title, and links nowhere', async () => {
  useSession.setState({ status: 'ready', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl: '/map' });
  expect(await screen.findByText(MAP_IN_PROGRESS_TITLE)).toBeTruthy();
  expect(screen.getByText(MAP_IN_PROGRESS_BODY)).toBeTruthy();
  expect(screen.getAllByText('Map').length).toBeGreaterThan(0);
  expect(screen.queryByRole('link')).toBeNull();
});

import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import LeaderboardRedirect from '@/app/leaderboard';

const Named = (name: string) =>
  function Screen() {
    return <Text>{name}</Text>;
  };

async function open(url: string) {
  const result = renderRouter(
    {
      leaderboard: LeaderboardRedirect,
      people: Named('People screen'),
      'lists/index': Named('Lists screen'),
    },
    { initialUrl: url },
  );
  await result;
  return () => result.getPathnameWithParams();
}

// /leaderboard is no longer a tab (TASKS.md M-32): old links land on the board's new home.
it('sends ?scope=users to /people', async () => {
  const path = await open('/leaderboard?scope=users');
  expect(await screen.findByText('People screen')).toBeTruthy();
  expect(path()).toBe('/people');
});

it.each(['/leaderboard', '/leaderboard?scope=bevs', '/leaderboard?scope=other&category=soda'])('sends %s to /lists?tab=top', async (url) => {
  const path = await open(url);
  expect(await screen.findByText('Lists screen')).toBeTruthy();
  expect(path()).toBe('/lists?tab=top');
});

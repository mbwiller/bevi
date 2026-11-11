import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * /leaderboard is no longer a tab (SPEC §1): its People board lives on /people and its Bevs board is
 * the Lists tab's Top. Old links land on the matching one: `?scope=users` → /people, anything else
 * → /lists?tab=top.
 */
export default function LeaderboardRedirect() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  return scope === 'users' ? <Redirect href="/people" /> : <Redirect href={{ pathname: '/lists', params: { tab: 'top' } }} />;
}

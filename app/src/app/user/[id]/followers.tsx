import { useLocalSearchParams } from 'expo-router';

import { useFollowers } from '@/api/hooks';
import { PeopleScreen } from '@/features/people/PeopleScreen';

/** Followers of a user (§6.15): UserRows with Follow pills, search within the list, infinite. */
export default function FollowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFollowers(id);
  return <PeopleScreen userId={id} title="Followers" query={query} which="followers" />;
}

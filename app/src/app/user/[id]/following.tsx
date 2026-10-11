import { useLocalSearchParams } from 'expo-router';

import { useFollowing } from '@/api/hooks';
import { PeopleScreen } from '@/features/people/PeopleScreen';

/** Who a user follows (§6.15): UserRows with Follow pills, search within the list, infinite. */
export default function FollowingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFollowing(id);
  return <PeopleScreen userId={id} title="Following" query={query} which="following" />;
}

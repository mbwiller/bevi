import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function FollowersScreen() {
  const back = useBack();
  return <Placeholder title="Followers" header={{ title: 'Followers', onBack: back }} />;
}

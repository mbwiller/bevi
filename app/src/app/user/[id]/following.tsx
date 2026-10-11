import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function FollowingScreen() {
  const back = useBack();
  return <Placeholder title="Following" header={{ title: 'Following', onBack: back }} />;
}

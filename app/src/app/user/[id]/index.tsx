import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function UserProfileScreen() {
  const back = useBack();
  return <Placeholder title="Profile" header={{ title: 'Profile', onBack: back }} />;
}

import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function AccountScreen() {
  const back = useBack();
  return <Placeholder title="Account" header={{ title: 'Account', onBack: back }} />;
}

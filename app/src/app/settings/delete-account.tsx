import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function DeleteAccountScreen() {
  const back = useBack();
  return <Placeholder title="Delete account" header={{ title: 'Delete account', onBack: back }} />;
}

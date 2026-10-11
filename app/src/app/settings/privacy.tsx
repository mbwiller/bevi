import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function PrivacyScreen() {
  const back = useBack();
  return <Placeholder title="Privacy" header={{ title: 'Privacy', onBack: back }} />;
}

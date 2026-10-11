import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function SignUpScreen() {
  const back = useBack();
  return <Placeholder title="Create account" header={{ title: 'Create account', onBack: back }} />;
}

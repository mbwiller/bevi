import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function OnboardingStarterScreen() {
  const back = useBack();
  return <Placeholder title="Starter ranking" header={{ title: 'Rank a few Bevs', onBack: back }} />;
}

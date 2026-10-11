import { Placeholder } from '@/dev/Placeholder';
import { SkipStarter } from '@/features/onboarding/SkipStarter';
import { useBack } from '@/lib/useBack';

export default function OnboardingStarterScreen() {
  const back = useBack();
  return (
    <Placeholder title="Starter ranking" header={{ title: 'Rank a few Bevs', onBack: back }}>
      {/* TODO(starter): temporary until the starter ranking (§6.3) is built. */}
      <SkipStarter />
    </Placeholder>
  );
}

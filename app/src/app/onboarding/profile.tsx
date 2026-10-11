import { Placeholder, PlaceholderLinks } from '@/dev/Placeholder';

export default function OnboardingProfileScreen() {
  return (
    <Placeholder title="Your profile" header={{ title: 'Your profile' }}>
      <PlaceholderLinks links={[{ label: 'Next: starter ranking', href: '/onboarding/starter' }]} />
    </Placeholder>
  );
}

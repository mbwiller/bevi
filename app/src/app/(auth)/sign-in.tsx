import { Placeholder, PlaceholderLinks } from '@/dev/Placeholder';

export default function SignInScreen() {
  return (
    <Placeholder title="Sign in" header={{ title: 'Sign in' }}>
      <PlaceholderLinks links={[{ label: 'Create account', href: '/sign-up' }]} />
    </Placeholder>
  );
}

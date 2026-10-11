import { Placeholder, PlaceholderLinks } from '@/dev/Placeholder';
import { sessionOverrideEnabled } from '@/dev/devSession';
import { useBack } from '@/lib/useBack';

export default function SettingsScreen() {
  const back = useBack();
  return (
    <Placeholder title="Settings" header={{ title: 'Settings', onBack: back }}>
      <PlaceholderLinks
        links={[
          { label: 'Account', href: '/settings/account' },
          { label: 'Privacy', href: '/settings/privacy' },
          { label: 'Delete account', href: '/settings/delete-account' },
        ]}
      />
      {sessionOverrideEnabled() ? (
        <PlaceholderLinks
          links={[
            { label: 'Component gallery', href: '/dev/gallery' },
            { label: 'Token preview', href: '/dev/tokens' },
          ]}
        />
      ) : null}
    </Placeholder>
  );
}

import { useRouter } from 'expo-router';

import { Placeholder } from '@/dev/Placeholder';
import { useSession } from '@/state/session';

export default function ProfileScreen() {
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  return (
    <Placeholder
      title="Profile"
      header={{
        title: profile?.displayName ?? 'Profile',
        actions: [{ icon: 'menu', label: 'Settings', onPress: () => router.push('/settings') }],
      }}
    />
  );
}

import { useRouter } from 'expo-router';

import { Placeholder } from '@/dev/Placeholder';

export default function FeedScreen() {
  const router = useRouter();
  return (
    <Placeholder
      title="Feed"
      header={{
        wordmark: true,
        // Find people lives in Add Bev's People tab (§6.8, §6.16).
        actions: [
          { icon: 'user-plus', label: 'Find people', onPress: () => router.push({ pathname: '/add', params: { tab: 'people' } }) },
        ],
      }}
    />
  );
}

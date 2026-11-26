import { Redirect } from 'expo-router';

import { PostNotificationsScreen } from '@/features/notifications/PostNotificationsScreen';
import { pushAvailable } from '@/features/notifications/push/availability';

/** Settings › Notifications › Choose people (T-31 Release 2). Like its parent, only where push is available. */
export default function PostNotificationsRoute() {
  if (!pushAvailable()) return <Redirect href="/settings" />;
  return <PostNotificationsScreen />;
}

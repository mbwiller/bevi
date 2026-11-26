import { Redirect } from 'expo-router';

import { NotificationSettingsScreen } from '@/features/notifications/NotificationSettingsScreen';
import { pushAvailable } from '@/features/notifications/push/availability';

/**
 * Settings › Notifications (T-31 Release 2). Only on a build that can receive push: anywhere else
 * (the web, a build before `extra.push`) a link here lands on Settings.
 */
export default function NotificationSettingsRoute() {
  if (!pushAvailable()) return <Redirect href="/settings" />;
  return <NotificationSettingsScreen />;
}

import { NotificationsScreen } from '@/features/notifications/NotificationsScreen';

/**
 * Notifications (T-31): who followed you, liked or commented on your posts. It lives in the tabs
 * group so the tab bar stays under it, as the design system's ScreenNotifications draws it, but it
 * is not one of the five tabs: the bar marks Feed, whose bell opens it (`tabIdFor` in the tabs layout).
 */
export default NotificationsScreen;

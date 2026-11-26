import type { NotificationSettings } from '@bevi/shared';

/**
 * What one switch on Settings > Notifications does to the five stored settings (T-31 Release 2;
 * design system ScreenNotificationSettings). The server keeps exactly what it is sent
 * (`notifications.updateSettings`), so these rules are the app's, and every switch goes through
 * them: the screen's own switches, and a person switched on in Post notifications (which turns
 * Posts on, as `applySettingToggle(settings, 'posts', true)` when Posts is not shown on).
 *
 * - Pause all on: `paused` only; the four kinds are kept, so they all show off.
 * - Pause all off: `paused` only; each kind is back exactly as it was.
 * - A kind switched on while paused ends the pause with only that kind on.
 * - Otherwise a kind switch changes that kind only.
 */

/** The four kinds of push, in the order the screen lists them. */
export type NotificationKindSetting = 'follows' | 'likes' | 'comments' | 'posts';
/** Every switch on the screen: Pause all and the four kinds. */
export type NotificationSettingKey = 'paused' | NotificationKindSetting;

export const NOTIFICATION_KINDS: readonly NotificationKindSetting[] = ['follows', 'likes', 'comments', 'posts'];

/** What someone who never saved anything has (`notifications.getSettings`' defaults). */
export const DEFAULT_SETTINGS: NotificationSettings = { paused: false, follows: true, likes: true, comments: true, posts: false };

/** The settings after the switch `key` is set to `on`. Never changes its argument. */
export function applySettingToggle(settings: NotificationSettings, key: NotificationSettingKey, on: boolean): NotificationSettings {
  if (key === 'paused') return { ...settings, paused: on };
  if (on && settings.paused) {
    return { paused: false, follows: false, likes: false, comments: false, posts: false, [key]: true };
  }
  return { ...settings, [key]: on };
}

/** What the switch `key` shows: Pause all shows `paused`; a kind shows on only while nothing is paused. */
export function shownAs(settings: NotificationSettings, key: NotificationSettingKey): boolean {
  if (key === 'paused') return settings.paused;
  return !settings.paused && settings[key];
}


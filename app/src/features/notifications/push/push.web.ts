// The web has no push (T-31 Release 2): every function is a no-op that says so. push.ts is the
// phone's. This file must never import expo-notifications, so the web bundle never carries it.

// From pushTypes, never from './push': on the web that path is this file.
import type { PushMessage, PushPermission, Unsubscribe } from './pushTypes';

export type { PushMessage, PushPermission, Unsubscribe } from './pushTypes';

export async function getPushPermission(): Promise<PushPermission> {
  return 'unavailable';
}

export async function requestPushPermission(): Promise<PushPermission> {
  return 'unavailable';
}

export async function getPushToken(): Promise<string | null> {
  return null;
}

export async function setAppBadge(_count: number): Promise<void> {}

export function configureForegroundPresentation(): void {}

export function onPushReceived(_cb: (message: PushMessage) => void): Unsubscribe {
  return () => {};
}

export function onPushOpened(_cb: (message: PushMessage) => void): Unsubscribe {
  return () => {};
}

export function openSystemSettings(): void {}

export function resetPushForTests(): void {}

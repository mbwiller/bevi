// The web build never receives push (T-31 Release 2): no Notifications settings, no ask, no
// permission, no token. availability.ts is the native gate.

export function pushAvailable(): boolean {
  return false;
}

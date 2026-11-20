import { CONTRACT_VERSION, type AppConfig } from '@bevi/shared';

export type Gate = 'open' | 'maintenance' | 'update';

/** `[major, minor, patch]` of a strict numeric `x.y.z`, or null for anything else. */
export function parseVersion(value: string | null | undefined): [number, number, number] | null {
  const match = typeof value === 'string' ? /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True only when both are well-formed and `a` is strictly below `b`. Numeric, so 0.9.0 < 0.10.0. */
function isBelow(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return (left[i] ?? 0) < (right[i] ?? 0);
  }
  return false;
}

/**
 * What the app should show for the backend's `app_config` (IM-9).
 *
 * It fails open. Only a config that was actually read can block: no data yet, a failed read, a
 * floor that is not `x.y.z`, or an installed version we cannot read all give 'open' for that check,
 * because a gate that fails closed would, with the backend paused, brick every installed binary.
 *
 * - 'maintenance' when the flag is on. It wins over 'update'. It needs no installed version, so the
 *   web build honours it too.
 * - 'update' when `minAppVersion` is above the installed native version, or `minContractVersion`
 *   is above this bundle's contract. With no installed version (the web build: a deploy is always
 *   current) neither is checked.
 */
export function gateFor(
  config: AppConfig | null | undefined,
  installed: string | null | undefined,
  bundleContract: string = CONTRACT_VERSION,
): Gate {
  if (!config) return 'open';
  if (config.maintenance === true) return 'maintenance';
  if (parseVersion(installed) === null) return 'open';
  if (isBelow(installed, config.minAppVersion) || isBelow(bundleContract, config.minContractVersion)) return 'update';
  return 'open';
}

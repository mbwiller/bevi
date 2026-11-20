/**
 * The web build has no binary, and a web deploy is always current, so it reports no version: the
 * gate never tells it to update (it still honours maintenance). The native file is installedVersion.ts.
 */
export function installedVersion(): string | null {
  return null;
}

export function installedBuild(): string | null {
  return null;
}

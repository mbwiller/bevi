import { createContext, useContext, type ReactNode } from 'react';

import type { HeaderAction } from './Header';

/**
 * One app-wide action that every `Header` puts first in its right-hand actions, supplied from above
 * rather than by each screen. It keeps `Header` presentational: the feature that decides whether
 * the action shows (today the internal Report a bug entry, `features/bug-report`) computes the value
 * and the root layout mounts the provider. With no provider, or an `undefined` value, Header draws
 * exactly its own `actions`.
 */
const HeaderLeadActionContext = createContext<HeaderAction | undefined>(undefined);

export function HeaderLeadActionProvider({ action, children }: { action: HeaderAction | undefined; children: ReactNode }) {
  return <HeaderLeadActionContext.Provider value={action}>{children}</HeaderLeadActionContext.Provider>;
}

/** The action to draw first, if any. Read by `Header` only. */
export function useHeaderLeadAction(): HeaderAction | undefined {
  return useContext(HeaderLeadActionContext);
}

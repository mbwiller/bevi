import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useAppConfig } from '@/api/hooks/feed';
import { useOnline } from '@/lib/useOnline';

import { gateFor } from './gateFor';
import { installedBuild, installedVersion } from './installedVersion';
import { MaintenanceNotice } from './MaintenanceNotice';
import { UpdateRequired } from './UpdateRequired';

/** Re-asks made because the app came back or the connection returned are at least this far apart. */
export const MIN_RECHECK_MS = 10_000;

/**
 * IM-9: the update / maintenance gate, around the whole app.
 *
 * - While the first read is in flight, or after a failed one, the gate is 'open': the app renders
 *   as it always did and first paint is never held (gateFor fails open).
 * - 'update' replaces the app: the children are unmounted, there is no route to reach.
 * - 'maintenance' lays MaintenanceNotice over the children, which stay mounted (same slot, so a
 *   screen, a draft and the session survive). It lifts by itself: `useAppConfig` polls every
 *   minute while it shows, and this re-asks when the app returns to the foreground and when the
 *   connection returns, at most once per MIN_RECHECK_MS so a flapping connection cannot cause a
 *   request storm. A read that fails keeps the last good answer rather than flipping the app.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const { data, refetch, isFetching } = useAppConfig();
  const gate = gateFor(data, installedVersion());
  const online = useOnline();
  const lastAsk = useRef(0);

  const recheck = useRef(() => undefined as unknown);
  recheck.current = () => {
    const now = Date.now();
    if (now - lastAsk.current < MIN_RECHECK_MS) return;
    lastAsk.current = now;
    void refetch();
  };

  const showing = gate === 'maintenance';
  useEffect(() => {
    if (!showing) return;
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') recheck.current();
    });
    return () => subscription.remove();
  }, [showing]);

  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && showing) recheck.current();
    wasOnline.current = online;
  }, [online, showing]);

  if (gate === 'update') return <UpdateRequired version={installedVersion()} build={installedBuild()} />;
  return (
    <View style={styles.fill}>
      {children}
      {showing ? (
        <MaintenanceNotice
          message={data?.maintenanceMessage ?? null}
          checking={isFetching}
          onRetry={() => {
            lastAsk.current = Date.now();
            void refetch();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

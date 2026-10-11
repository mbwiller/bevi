import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { errorCopy } from '@/lib/errorCopy';

import { StateMessage } from './EmptyState';
import type { IconName } from './Icon';
import { Pill } from './Pill';

export { errorCopy, type ErrorCopy } from '@/lib/errorCopy';

export interface ErrorStateProps {
  /** The thrown value (usually an `ApiError`): picks the title, message, icon and whether Retry shows. */
  error?: unknown;
  /** Overrides the copy from `error`. */
  title?: string;
  message?: string;
  icon?: IconName;
  /** Retry shows when this is set and the error is one a retry can fix. */
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Failure message from `BeviApi` errors with a Retry. Says what happened and what to do; no apologies, no codes. */
export function ErrorState({ error, title, message, icon, onRetry, style }: ErrorStateProps) {
  const copy = errorCopy(error);
  return (
    <StateMessage icon={icon ?? copy.icon} title={title ?? copy.title} body={message ?? copy.message} style={style} alert>
      {onRetry && copy.retry ? (
        <Pill variant="outlined" icon="refresh-cw" onPress={onRetry} style={styles.action}>
          Retry
        </Pill>
      ) : null}
    </StateMessage>
  );
}

const styles = StyleSheet.create({ action: { alignSelf: 'center' } });

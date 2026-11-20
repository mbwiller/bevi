import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/EmptyState';
import { Pill } from '@/components/Pill';
import { spacing, useTheme } from '@/theme';

export const MAINTENANCE_TITLE = "We'll be right back";
export const MAINTENANCE_DEFAULT_BODY = "Bevi is down for maintenance. Your Bevs are safe. This goes away on its own when we're done.";

export interface MaintenanceNoticeProps {
  /** The founders' message from `app_config`, when there is one. */
  message: string | null;
  /** Ask the backend again. */
  onRetry: () => void;
  /** A read is in flight: Try again waits. */
  checking?: boolean;
}

/**
 * Maintenance, laid over the app (AppGate keeps the app mounted underneath, so nothing a person
 * had open is lost). Opaque, so Reduce Transparency changes nothing; `accessibilityViewIsModal`
 * keeps VoiceOver on this screen and off the one underneath.
 */
export function MaintenanceNotice({ message, onRetry, checking = false }: MaintenanceNoticeProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      testID="maintenance-notice"
      accessibilityViewIsModal
      aria-modal
      style={[styles.overlay, { backgroundColor: colors.surface }]}
    >
      <View style={styles.center}>
        <StateMessage icon="triangle-alert" title={MAINTENANCE_TITLE} body={message?.trim() || MAINTENANCE_DEFAULT_BODY} alert>
          <Pill
            variant="outlined"
            icon="refresh-cw"
            onPress={onRetry}
            disabled={checking}
            accessibilityLabel={checking ? 'Checking' : 'Try again'}
            style={styles.action}
          >
            {checking ? 'Checking…' : 'Try again'}
          </Pill>
        </StateMessage>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 },
  center: { flex: 1, justifyContent: 'center', padding: spacing.gutter },
  action: { alignSelf: 'center' },
});

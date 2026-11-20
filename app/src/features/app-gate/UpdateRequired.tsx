import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/EmptyState';
import { Pill } from '@/components/Pill';
import { Wordmark } from '@/components/Wordmark';
import { APP_STORE_ID, SUPPORT_EMAIL, appStoreUrl } from '@/lib/appStore';
import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';

export const UPDATE_TITLE = 'Update Bevi';
export const UPDATE_BODY = 'This version of Bevi is too old to keep working. Your Bevs are safe.';
export const UPDATE_BODY_WITH_STORE = `${UPDATE_BODY} Update to the latest version to carry on.`;
export const UPDATE_BODY_NO_STORE = `${UPDATE_BODY} Update from TestFlight or the App Store to carry on.`;

const WORDMARK_HEIGHT = 56;

export interface UpdateRequiredProps {
  /** The installed binary's version and build, small, for support. Either may be unknown. */
  version?: string | null;
  build?: string | null;
  /** Default: src/lib/appStore.ts. Null: no Update button. */
  appStoreId?: string | null;
  /** Default: src/lib/appStore.ts. Null: no contact line. */
  supportEmail?: string | null;
}

function open(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

/** Replaces the app: this binary is below what the backend still serves. No way past it. */
export function UpdateRequired({ version, build, appStoreId = APP_STORE_ID, supportEmail = SUPPORT_EMAIL }: UpdateRequiredProps) {
  const { colors } = useTheme();
  const detail = [version ? `Version ${version}` : null, build ? `build ${build}` : null].filter(Boolean).join(' ');
  return (
    <SafeAreaView testID="update-required" style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={styles.center}>
        <Wordmark height={WORDMARK_HEIGHT} />
        <StateMessage icon="triangle-alert" title={UPDATE_TITLE} body={appStoreId ? UPDATE_BODY_WITH_STORE : UPDATE_BODY_NO_STORE}>
          {appStoreId ? (
            <Pill variant="filled" onPress={() => open(appStoreUrl(appStoreId))} accessibilityLabel="Update Bevi in the App Store" style={styles.action}>
              Update
            </Pill>
          ) : null}
          {supportEmail ? (
            <Pill
              variant="outlined"
              onPress={() => open(`mailto:${supportEmail}`)}
              accessibilityLabel={`Contact us at ${supportEmail}`}
              style={styles.action}
            >
              {`Contact us at ${supportEmail}`}
            </Pill>
          ) : null}
        </StateMessage>
      </View>
      {detail ? (
        <Text style={[type.caption, styles.detail, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {detail}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.gutter, gap: spacing.xxl },
  action: { alignSelf: 'center' },
  detail: { textAlign: 'center', paddingBottom: spacing.lg },
});

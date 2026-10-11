import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Markdown } from '@/features/settings/Markdown';
import { SettingsScreen } from '@/features/settings/SettingsRow';
import { spacing } from '@/theme';

/** The privacy note, a static file served with the web app (app/public/privacy.md → /privacy.md). */
export const PRIVACY_URL = '/privacy.md';

async function fetchPrivacy(): Promise<string> {
  const res = await fetch(PRIVACY_URL);
  if (!res.ok) throw new Error(`privacy.md: ${res.status}`);
  return res.text();
}

/** Settings › Privacy (§6.18): the bundled privacy note, rendered as plain paragraphs. */
export default function PrivacyScreen() {
  const doc = useQuery({ queryKey: ['static', 'privacy'], queryFn: fetchPrivacy, staleTime: Infinity });
  return (
    <SettingsScreen title="Privacy">
      {doc.isPending ? (
        <View style={styles.loading}>
          <Skeleton lines={8} />
        </View>
      ) : doc.isError ? (
        <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
      ) : (
        <Markdown source={doc.data} />
      )}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({ loading: { padding: spacing.gutter } });

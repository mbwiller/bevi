import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Pill } from '@/components/Pill';
import { useSession, type SessionStatus } from '@/state/session';
import { size, spacing, type, useTheme } from '@/theme';

import { Group, Row } from './parts';
import type { GallerySection } from './types';

const STATUSES: { id: SessionStatus; label: string }[] = [
  { id: 'signedOut', label: 'Signed out' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'ready', label: 'Ready' },
];

/** Dev toggle for the session gate (same as `?session=` in the URL). Not a design-system component. */
function Session() {
  const { colors } = useTheme();
  const status = useSession((s) => s.status);
  const setStatus = useSession((s) => s.setStatus);
  return (
    <Group title="Session status">
      <Row align="center">
        {STATUSES.map((s) => (
          <Pill key={s.id} active={status === s.id} onPress={() => setStatus(s.id)} accessibilityLabel={`Session: ${s.label}`}>
            {s.label}
          </Pill>
        ))}
      </Row>
      <Link href="/" style={[type.body, styles.link, { color: colors.primary }]} accessibilityLabel="Open the app">
        Open the app
      </Link>
      <Text style={[type.caption, { color: colors.textSecondary }]}>
        The gate sends signed out to sign in, onboarding to the profile step, ready to the tabs.
      </Text>
    </Group>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: size.target, paddingVertical: spacing.md, alignSelf: 'flex-start' },
});

export const session: GallerySection = { id: 'session', title: 'Session (dev)', Component: Session };

import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { spacing, useTheme } from '@/theme';

export const MAP_IN_PROGRESS_TITLE = 'The map is in progress';
export const MAP_IN_PROGRESS_BODY = "Soon you'll see where you and your friends Bev'd.";

/**
 * The Map tab while the map is being built: the tab keeps its place in the bar and says what is
 * coming. Replaced by the real map when Bevs carry a location.
 */
export function MapInProgressScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Map" />
      <View style={styles.body}>
        <EmptyState icon="map-pin" title={MAP_IN_PROGRESS_TITLE} body={MAP_IN_PROGRESS_BODY} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
});

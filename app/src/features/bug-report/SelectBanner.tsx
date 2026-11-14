import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { size, spacing, type, useTheme } from '@/theme';

import { REPORT_UI } from './ReportLayer';
import { cancelSelecting, useReport } from './store';

/**
 * Select mode's one piece of chrome: a slim bar along the top of the column, under the safe area,
 * saying what to do and offering Cancel. The page under it still scrolls; the engine turns a tap on
 * the app into a selection (pickMode.ts).
 */
export function SelectBanner() {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const selecting = useReport((s) => s.selecting);
  if (!selecting) return null;
  return (
    <View
      {...REPORT_UI}
      style={[
        styles.bar,
        { top: insets.top, backgroundColor: colors.surface, borderBottomColor: colors.border, boxShadow: elevation.floating },
      ]}
      accessibilityLiveRegion="polite"
      role="status"
      testID="report-select-banner"
    >
      <Text style={[type.body, styles.text, { color: colors.text }]} numberOfLines={1}>
        Tap what you mean
      </Text>
      <Button variant="ghost" onPress={cancelSelecting}>
        Cancel
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    minHeight: size.target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.xs,
    borderBottomWidth: 1,
  },
  text: { flex: 1, minWidth: 0, fontWeight: '600' },
});

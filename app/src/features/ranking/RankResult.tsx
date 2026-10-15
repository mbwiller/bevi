import type { SubmitRankingResult } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn, useReducedMotion } from 'react-native-reanimated';

import { Button } from '@/components/Button';
import { ScoreBubble } from '@/components/ScoreBubble';
import { motion, spacing, type, useTheme } from '@/theme';

import { rankLine } from './copy';

/**
 * Ranking flow step 4: ScoreBubble 56 springs in (appears at once under Reduce Motion) over "#4 of 31 in Loved · 8.9",
 * confirming the score the note step revealed, then Done.
 */
export function RankResult({ bevName, result, onDone }: { bevName: string; result: SubmitRankingResult; onDone: () => void }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const { ranking, bucketSize } = result;
  const line = rankLine(ranking.position, bucketSize, ranking.bucket, ranking.score);
  return (
    <View style={styles.wrap}>
      <View style={styles.center}>
        <Animated.View
          testID="result-score"
          entering={reduced ? undefined : ZoomIn.springify().damping(motion.springy.damping).stiffness(motion.springy.stiffness)}
        >
          <ScoreBubble score={ranking.score} bucket={ranking.bucket} size={56} />
        </Animated.View>
        <Text style={[type.screenTitle, styles.text, { color: colors.text }]} accessibilityRole="header">
          {bevName}
        </Text>
        <Text style={[type.bodyLarge, styles.text, { color: colors.text }]} accessibilityLiveRegion="polite">
          {line}
        </Text>
      </View>
      <Button variant="primary" block onPress={onDone}>
        Done
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.gutter, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  text: { textAlign: 'center' },
});

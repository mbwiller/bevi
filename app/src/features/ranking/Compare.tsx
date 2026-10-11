import type { PlacementPrompt } from '@bevi/ranking';
import type { Bev, Bucket } from '@bevi/shared';
import { useEffect } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useBev } from '@/api/hooks';
import { Button } from '@/components/Button';
import { CompareCard } from '@/components/CompareCard';
import { ErrorState } from '@/components/ErrorState';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { ProgressDots } from '@/components/ProgressDots';
import { Skeleton } from '@/components/Skeleton';
import { motion, size, spacing, type, useTheme } from '@/theme';

import { incumbentLabel } from './copy';
import { Notice } from './Notice';

export interface CompareProps {
  bev: Bev;
  bucket: Bucket;
  prompt: PlacementPrompt;
  /** The fetched bucket list, for the incumbent's "#3 in Loved". */
  orderedIds: readonly string[];
  /** A short notice above the question (after a conflict restart). */
  notice?: string | null;
  /** Ignore keys while a sheet is open over the screen. */
  keysEnabled?: boolean;
  onNewBetter: () => void;
  onExistingBetter: () => void;
  onTie: () => void;
  onUndo: () => void;
  onClose: () => void;
}

/** ScreenRanking: the incumbent card's height while it loads (BevImage 96 + 2 × 16pt padding + border). */
const CARD_H = 96 + spacing.lg * 2 + 2;

/**
 * Ranking flow step 2 (design system ScreenRanking): "Which was better?", the new Bev on top and the
 * incumbent below, "Too close to call" and Undo. Keys on web: 1 / ↑ new, 2 / ↓ incumbent, T tie, U undo.
 */
export function Compare({
  bev,
  bucket,
  prompt,
  orderedIds,
  notice,
  keysEnabled = true,
  onNewBetter,
  onExistingBetter,
  onTie,
  onUndo,
  onClose,
}: CompareProps) {
  const { colors } = useTheme();
  const incumbent = useBev(prompt.comparedBevId);

  useEffect(() => {
    if (Platform.OS !== 'web' || !keysEnabled || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === '1' || k === 'arrowup') onNewBetter();
      else if (k === '2' || k === 'arrowdown') {
        if (incumbent.data) onExistingBetter();
      } else if (k === 't') onTie();
      else if (k === 'u') onUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysEnabled, incumbent.data, onNewBetter, onExistingBetter, onTie, onUndo]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.top}>
        <ProgressDots total={prompt.maxSteps} current={prompt.step - 1} />
        <IconButton icon="x" label="Discard ranking" variant="filled" onPress={onClose} />
      </View>
      {notice ? (
        <Notice>{notice}</Notice>
      ) : null}
      <Text style={[type.displayDrop, styles.prompt, { color: colors.text }]} accessibilityRole="header">
        Which was better?
      </Text>
      <View style={styles.cards}>
        <CompareCard bev={bev} isNew onPress={onNewBetter} />
        <Text style={[type.caption, styles.or, { color: colors.textSecondary }]} aria-hidden>
          OR
        </Text>
        {incumbent.data ? (
          <Animated.View key={prompt.comparedBevId} entering={FadeIn.duration(motion.base)}>
            <CompareCard
              bev={incumbent.data}
              rankLabel={incumbentLabel(orderedIds, prompt.comparedBevId, bucket)}
              onPress={onExistingBetter}
            />
          </Animated.View>
        ) : incumbent.isError ? (
          <ErrorState error={incumbent.error} onRetry={() => void incumbent.refetch()} />
        ) : (
          <Skeleton variant="block" height={CARD_H} />
        )}
      </View>
      <View style={styles.foot}>
        <Pill variant="outlined" onPress={onTie}>
          Too close to call
        </Pill>
        <Button variant="ghost" size="md" icon="undo-2" onPress={onUndo}>
          Undo
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: size.header,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.sm,
  },
  prompt: { marginTop: spacing.xl, marginBottom: spacing.lg, marginHorizontal: spacing.gutter },
  cards: { gap: spacing.md, paddingHorizontal: spacing.gutter },
  or: { alignSelf: 'center', fontWeight: '600', letterSpacing: 0.5 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xl, paddingHorizontal: spacing.gutter },
});

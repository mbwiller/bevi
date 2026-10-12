import { isApiError, type BevSummary, type Bucket, type SubmitRankingResult } from '@bevi/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBev, useBucket, useSubmitRanking } from '@/api/hooks';
import { bevArtForCategory } from '@/components/BevArt';
import { BevGlow } from '@/components/BevGlow';
import { BevImage } from '@/components/BevImage';
import { brandLine } from '@/components/BevParts';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { IconButton } from '@/components/IconButton';
import { ScoreBubble } from '@/components/ScoreBubble';
import { Skeleton } from '@/components/Skeleton';
import { Compare } from '@/features/ranking/Compare';
import { CONFLICT_NOTICE, rankLine } from '@/features/ranking/copy';
import { GutCheck } from '@/features/ranking/GutCheck';
import { nextCandidates, selectDone, selectPrompt, useRankingFlow } from '@/state/rankingFlow';
import { motion, size, spacing, type, useTheme } from '@/theme';

import { STARTER_COPY, progressLine, thresholdLine } from './copy';

type Phase = 'ask' | 'gut' | 'loading' | 'compare' | 'saving' | 'placed';

export interface StarterStepProps {
  bev: BevSummary;
  /** 0-based position in the set, and the set's size ("3 of 10"). */
  index: number;
  total: number;
  /** How many Bevs the user has ranked so far. */
  ranked: number;
  /** Done is on once `ranked` reaches MIN_N_USER. */
  canFinish: boolean;
  onFinish: () => void;
  /** "Haven't had it", or the Bev turned out to be ranked already. */
  onSkip: () => void;
  /** Saved: on to the next Bev. */
  onNext: () => void;
  /** A ranking was saved (counted at once, before the rankings refetch lands). */
  onSaved: (bevId: string) => void;
}

const flow = () => useRankingFlow.getState();

/**
 * One Bev of the starter set (§6.3): "Have you had this?" → Yes runs the ranking flow inline (the
 * same GutCheck and Compare steps as §6.9, driving the `rankingFlow` store), then submits without
 * a note; No skips. Keyed by Bev id by the parent, so each Bev starts fresh.
 */
export function StarterStep({ bev: summary, index, total, ranked, canFinish, onFinish, onSkip, onNext, onSaved }: StarterStepProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const bevQ = useBev(summary.id);
  const submit = useSubmitRanking();

  const placement = useRankingFlow((s) => s.placement);
  const orderedIds = useRankingFlow((s) => s.orderedIds);
  const prompt = useMemo(() => selectPrompt({ placement }), [placement]);
  const upcoming = useMemo(() => nextCandidates(placement), [placement]);
  useBev(upcoming[0]);
  useBev(upcoming[1]);

  const [phase, setPhase] = useState<Phase>('ask');
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<SubmitRankingResult | null>(null);
  const bucketQ = useBucket(bucket ?? undefined);

  useEffect(() => {
    flow().reset();
    return () => flow().reset();
  }, []);

  // Coming back to onboarding: a Bev ranked on an earlier visit is passed over. Yes and No wait for
  // the Bev to load, so a ranked one can't be started before this check runs.
  const alreadyRanked = phase === 'ask' && !!bevQ.data?.myRanking;
  const answerable = !!bevQ.data && !alreadyRanked;
  useEffect(() => {
    if (alreadyRanked) onSkip();
  }, [alreadyRanked, onSkip]);

  const pour = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pour.current), []);
  const choose = (b: Bucket) => {
    setBucket(b);
    clearTimeout(pour.current);
    pour.current = setTimeout(() => setPhase('loading'), reduced ? 0 : motion.pour);
  };

  /**
   * Re-saves started by a conflict restart rather than by the user. A restart on an empty (or
   * unchanged) list is done at once and saves again by itself; one such re-save is allowed, then the
   * error shows with Retry, so a server that keeps answering `conflict` can't loop requests.
   */
  const autoResaves = useRef(0);

  const save = useCallback(
    async (auto = false) => {
      const r = flow().result();
      if (!r) return;
      if (!auto) autoResaves.current = 0;
      setPhase('saving');
      setSaveError(null);
      try {
        const res = await submit.mutateAsync({
          bevId: r.bevId,
          bucket: r.bucket,
          insertIndex: r.insertIndex,
          expectedBucketSize: r.expectedBucketSize,
          comparisons: r.comparisons,
        });
        onSaved(r.bevId);
        setOutcome(res);
        setPhase('placed');
      } catch (e) {
        if (!isApiError(e) || e.code !== 'conflict') return setSaveError(e);
        // Ranked elsewhere already: nothing to place, move on. `detail.reason` is only a fast path
        // (the test FakeApi sends it; the real API answers a bare conflict), so otherwise re-read the Bev.
        if ((e.detail as { reason?: string } | undefined)?.reason === 'already_ranked') return onNext();
        const bevNow = await bevQ.refetch();
        if (!bevNow.isError && bevNow.data?.myRanking) return onNext();
        // The bucket changed: place again on the fresh list (never on a stale cached one).
        const fresh = await bucketQ.refetch();
        if (fresh.isError || !fresh.data) return setSaveError(fresh.error ?? e);
        flow().restart(fresh.data);
        setNotice(CONFLICT_NOTICE);
        if (!selectDone(flow())) return setPhase('compare');
        if (autoResaves.current >= 1) return setSaveError(e);
        autoResaves.current += 1;
        return void save(true);
      }
    },
    [submit, bevQ, bucketQ, onNext, onSaved],
  );

  // Start placement on a bucket list fetched after the bucket was chosen (never a stale cached one).
  useEffect(() => {
    if (phase !== 'loading' || !bucket) return;
    if (!bucketQ.data || !bucketQ.isFetchedAfterMount || bucketQ.isFetching) return;
    flow().start(summary.id, bucket, bucketQ.data, 'new');
    if (selectDone(flow())) void save();
    else setPhase('compare');
  }, [phase, bucket, summary.id, bucketQ.data, bucketQ.isFetchedAfterMount, bucketQ.isFetching, save]);

  // The last answer finishes placement: save it (onboarding skips the note).
  useEffect(() => {
    if (phase === 'compare' && selectDone({ placement })) void save();
  }, [phase, placement, save]);

  const answerNew = useCallback(() => flow().answer('NEW_BETTER'), []);
  const answerExisting = useCallback(() => flow().answer('EXISTING_BETTER'), []);
  const tie = useCallback(() => flow().tie(), []);
  const backToAsk = useCallback(() => {
    clearTimeout(pour.current);
    flow().reset();
    setBucket(null);
    setNotice(null);
    setSaveError(null);
    setPhase('ask');
  }, []);
  const undo = useCallback(() => {
    const p = flow().placement;
    if (p && p.history.length > 0) return flow().undo();
    flow().reset();
    setBucket(null);
    setNotice(null);
    setPhase('gut');
  }, []);

  const bev = bevQ.data;

  if (phase === 'gut' || phase === 'loading') {
    if (!bev) {
      return bevQ.isError ? (
        <Screen>
          <ErrorState error={bevQ.error} onRetry={() => void bevQ.refetch()} />
        </Screen>
      ) : (
        <Screen>
          <View style={styles.center} accessibilityLabel="Loading" aria-busy>
            <Skeleton variant="circle" width={200} height={200} />
          </View>
        </Screen>
      );
    }
    if (phase === 'loading' && bucketQ.isError) {
      return (
        <Screen>
          <TopBar onClose={backToAsk} />
          <ErrorState error={bucketQ.error} onRetry={() => void bucketQ.refetch()} />
        </Screen>
      );
    }
    return (
      <View style={[styles.fill, { backgroundColor: colors.surface }]}>
        <BevGlow color={bevArtForCategory(bev.categoryId).color} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.fill}>
          <GutCheck bev={bev} chosen={bucket} onChoose={choose} onClose={backToAsk} />
        </SafeAreaView>
      </View>
    );
  }

  if (phase === 'compare' && bev && bucket && prompt) {
    return (
      <Screen>
        <Compare
          bev={bev}
          bucket={bucket}
          prompt={prompt}
          orderedIds={orderedIds}
          notice={notice}
          onNewBetter={answerNew}
          onExistingBetter={answerExisting}
          onTie={tie}
          onUndo={undo}
          onClose={backToAsk}
        />
      </Screen>
    );
  }

  if (phase === 'saving' || phase === 'compare') {
    return (
      <Screen>
        <TopBar onClose={saveError ? backToAsk : undefined} />
        {saveError ? (
          <ErrorState error={saveError} title={STARTER_COPY.saveFailed} onRetry={() => void save()} />
        ) : (
          <View style={styles.center} accessibilityLabel="Saving" aria-busy>
            <Skeleton variant="circle" width={56} height={56} />
            <Skeleton variant="text" lines={2} width="60%" />
          </View>
        )}
      </Screen>
    );
  }

  if (phase === 'placed' && outcome) {
    const { ranking, bucketSize } = outcome;
    return (
      <Screen>
        <View style={styles.placed}>
          <View style={styles.center}>
            <Animated.View
              entering={reduced ? undefined : ZoomIn.springify().damping(motion.springy.damping).stiffness(motion.springy.stiffness)}
            >
              <ScoreBubble score={ranking.score} bucket={ranking.bucket} size={56} />
            </Animated.View>
            <Text style={[type.screenTitle, styles.text, { color: colors.text }]} accessibilityRole="header">
              {summary.name}
            </Text>
            <Text style={[type.bodyLarge, styles.text, { color: colors.text }]} accessibilityLiveRegion="polite">
              {rankLine(ranking.position, bucketSize, ranking.bucket, ranking.score)}
            </Text>
            <Text style={[type.body, styles.text, { color: colors.textSecondary }]}>
              {STARTER_COPY.placed} {thresholdLine(ranked)}
            </Text>
          </View>
          <Button variant="primary" block onPress={onNext}>
            {STARTER_COPY.next}
          </Button>
          {canFinish ? (
            <Button variant="outlined" block onPress={onFinish}>
              {STARTER_COPY.done}
            </Button>
          ) : null}
        </View>
      </Screen>
    );
  }

  // "Have you had this?"
  const brand = brandLine(summary);
  return (
    <Screen>
      <View style={styles.top}>
        <Text style={[type.heading, styles.progress, { color: colors.text }]} accessibilityLabel={`Bev ${progressLine(index, total)}`}>
          {progressLine(index, total)}
        </Text>
        <Button
          variant="ghost"
          disabled={!canFinish}
          onPress={onFinish}
        >
          {STARTER_COPY.done}
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.ask}>
        <BevImage src={summary.photoUrl ?? undefined} art={bevArtForCategory(summary.categoryId)} alt={summary.name} size={155} />
        <Text style={[type.screenTitle, styles.text, { color: colors.text }]} accessibilityRole="header">
          {summary.name}
        </Text>
        {brand ? <Text style={[type.body, styles.text, { color: colors.textSecondary }]}>{brand}</Text> : null}
        <Text style={[type.displayDrop, styles.question, { color: colors.text }]}>{STARTER_COPY.question}</Text>
        <View style={styles.answers}>
          <Button variant="primary" block onPress={() => setPhase('gut')} disabled={!answerable}>
            {STARTER_COPY.yes}
          </Button>
          <Button variant="outlined" block size="lg" onPress={onSkip} disabled={!answerable}>
            {STARTER_COPY.no}
          </Button>
        </View>
        <Text style={[type.caption, styles.text, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {thresholdLine(ranked)}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function TopBar({ onClose }: { onClose?: () => void }) {
  return (
    <View style={styles.bar}>
      {onClose ? <IconButton icon="x" label="Back to this Bev" variant="filled" onPress={onClose} /> : null}
    </View>
  );
}

function Screen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.header,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.sm,
  },
  progress: { fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', height: size.header, paddingHorizontal: spacing.sm },
  ask: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  question: { marginTop: spacing.xl, marginBottom: spacing.md, textAlign: 'center' },
  answers: { alignSelf: 'stretch', gap: spacing.md, marginBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.gutter },
  placed: { flex: 1, padding: spacing.gutter, gap: spacing.md },
  text: { textAlign: 'center' },
});

import { MIN_N_USER } from '@bevi/ranking';
import type { BevSummary } from '@bevi/shared';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useMyRankings, useStarterCandidates, useUpdateMe } from '@/api/hooks';
import { flattenPages } from '@/api/hooks/util';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { useBack } from '@/lib/useBack';
import { useSession } from '@/state/session';
import { spacing, type, useTheme } from '@/theme';

import { STARTER_COPY, thresholdLine } from './copy';
import { hasMoreStarters, selectStarterRound } from './selection';
import { StarterStep } from './StarterStep';
import { StarterSummary } from './StarterSummary';

/** Enough to count every starter ranking (the API's page cap). */
const RANKINGS_LIMIT = 100;
const SKELETON_BLOCK = 155;

type View_ = 'intro' | 'steps' | 'summary';

/**
 * §6.3 Onboarding step 2: the starter ranking. Candidates → `selectStarterSet` (seeded by the user
 * id) → one Bev at a time; Done turns on at MIN_N_USER rankings; the summary finishes onboarding.
 * Onboarding routes can't reach search, so running out offers "Show me more" (the next round of
 * starters, a new seed over the ones not shown yet).
 */
export function StarterScreen() {
  const { colors } = useTheme();
  const back = useBack();
  const me = useMe();
  const candidatesQ = useStarterCandidates();
  const rankingsQ = useMyRankings({ limit: RANKINGS_LIMIT });
  const updateMe = useUpdateMe();
  const completeOnboarding = useSession((s) => s.completeOnboarding);

  const [view, setView] = useState<View_>('intro');
  const [roundCount, setRoundCount] = useState(1);
  const [index, setIndex] = useState(0);

  const candidates = candidatesQ.data;
  const profile = me.data;
  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);
  const { ids, seen } = useMemo(() => {
    const out: string[] = [];
    const shown = new Set<string>();
    if (!candidates || !profile) return { ids: out, seen: shown };
    for (let r = 0; r < roundCount; r++) {
      for (const id of selectStarterRound(candidates, profile, r, shown)) {
        out.push(id);
        shown.add(id);
      }
    }
    return { ids: out, seen: shown };
  }, [candidates, profile, roundCount]);

  const rankings = useMemo(() => flattenPages(rankingsQ.data), [rankingsQ.data]);
  const ranked = rankings.length;
  const canFinish = ranked >= MIN_N_USER;

  const advance = useCallback(() => setIndex((i) => i + 1), []);
  const finish = () => updateMe.mutate({ onboarded: true }, { onSuccess: (p) => completeOnboarding(p) });

  const blocking = me.error ?? candidatesQ.error ?? null;
  const retry = () => {
    if (me.isError) void me.refetch();
    if (candidatesQ.isError) void candidatesQ.refetch();
  };

  let body: ReactNode;
  if (blocking) {
    body = <ErrorState error={blocking} onRetry={retry} />;
  } else if (!candidates || !profile) {
    body = (
      <View style={styles.pad} accessibilityLabel="Loading" aria-busy>
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="block" height={SKELETON_BLOCK} />
      </View>
    );
  } else if (ids.length === 0) {
    body = (
      <EmptyState
        title={STARTER_COPY.emptyTitle}
        body={STARTER_COPY.emptyBody}
        action={STARTER_COPY.tryAgain}
        onAction={() => void candidatesQ.refetch()}
      />
    );
  } else if (view === 'intro') {
    body = (
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
          {STARTER_COPY.introTitle}
        </Text>
        <Text style={[type.bodyLarge, { color: colors.text }]}>{STARTER_COPY.introBody}</Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>{thresholdLine(ranked)}</Text>
        <Button variant="primary" block onPress={() => setView('steps')}>
          {STARTER_COPY.start}
        </Button>
      </ScrollView>
    );
  } else if (view === 'summary' || (index >= ids.length && canFinish)) {
    body = (
      <StarterSummary
        rankings={rankings}
        finishing={updateMe.isPending || updateMe.isSuccess}
        finishError={updateMe.error}
        onFinish={finish}
        onRankMore={() => {
          updateMe.reset();
          if (index >= ids.length) {
            if (hasMoreStarters(candidates, profile, seen)) setRoundCount((n) => n + 1);
            else setIndex(0);
          }
          setView('steps');
        }}
      />
    );
  } else if (index >= ids.length) {
    // Out of Bevs before reaching MIN_N_USER.
    const more = hasMoreStarters(candidates, profile, seen);
    body = (
      <EmptyState
        icon="cup-soda"
        title={STARTER_COPY.outTitle}
        body={`${more ? STARTER_COPY.outBodyMore : STARTER_COPY.outBodyAgain} ${thresholdLine(ranked)}`}
        action={more ? STARTER_COPY.showMore : STARTER_COPY.again}
        onAction={() => (more ? setRoundCount((n) => n + 1) : setIndex(0))}
      />
    );
  } else {
    const id = ids[index]!;
    const bev = byId.get(id) as BevSummary;
    return (
      <StarterStep
        key={`${index}:${id}`}
        bev={bev}
        index={index}
        total={ids.length}
        ranked={ranked}
        canFinish={canFinish}
        onFinish={() => setView('summary')}
        onSkip={advance}
        onNext={advance}
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <Header title="Rank a few Bevs" onBack={view === 'intro' ? back : undefined} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { gap: spacing.lg, padding: spacing.gutter },
});

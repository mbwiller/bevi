import { MIN_N_USER } from '@bevi/ranking';
import type { BevSummary } from '@bevi/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

import { STARTER_COPY, introBody, thresholdLine } from './copy';
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
  const [rounds, setRounds] = useState<string[][] | null>(null);
  const [index, setIndex] = useState(0);

  const candidates = candidatesQ.data;
  const profile = me.data;
  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);
  // Each round is picked once and kept: ranking a Bev changes its ratingCount, and a re-pick on
  // the refetched candidates would reorder the set under the user.
  useEffect(() => {
    if (!rounds && candidates && profile) setRounds([selectStarterRound(candidates, profile, 0)]);
  }, [rounds, candidates, profile]);
  const ids = useMemo(() => (rounds ?? []).flat(), [rounds]);
  const seen = useMemo(() => new Set(ids), [ids]);
  const nextRound = () => {
    if (!candidates || !profile) return;
    setRounds((r) => [...(r ?? []), selectStarterRound(candidates, profile, r?.length ?? 0, seen)]);
  };

  const rankings = useMemo(() => flattenPages(rankingsQ.data), [rankingsQ.data]);
  // Saves count at once; the rankings refetch catches up a moment later.
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const ranked = useMemo(() => new Set([...rankings.map((r) => r.bevId), ...savedIds]).size, [rankings, savedIds]);
  const onSaved = useCallback((id: string) => setSavedIds((s) => new Set(s).add(id)), []);
  const canFinish = ranked >= MIN_N_USER;

  const advance = useCallback(() => setIndex((i) => i + 1), []);
  const finish = () => updateMe.mutate({ onboarded: true }, { onSuccess: (p) => completeOnboarding(p) });

  // A rankings refetch that fails after a save keeps the list it had; only a first load blocks.
  const rankingsError = rankingsQ.isError && !rankingsQ.data ? rankingsQ.error : null;
  const blocking = me.error ?? candidatesQ.error ?? rankingsError ?? null;
  const retry = () => {
    if (me.isError) void me.refetch();
    if (candidatesQ.isError) void candidatesQ.refetch();
    if (rankingsQ.isError) void rankingsQ.refetch();
  };

  let body: ReactNode;
  if (blocking) {
    body = <ErrorState error={blocking} onRetry={retry} />;
  } else if (!candidates || !profile || !rounds) {
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
        onAction={() => {
          setRounds(null);
          void candidatesQ.refetch();
        }}
      />
    );
  } else if (view === 'intro') {
    body = (
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
          {STARTER_COPY.introTitle}
        </Text>
        <Text style={[type.bodyLarge, { color: colors.text }]}>{introBody(ids.length)}</Text>
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
            if (hasMoreStarters(candidates, profile, seen)) nextRound();
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
        onAction={() => (more ? nextRound() : setIndex(0))}
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
        onSaved={onSaved}
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

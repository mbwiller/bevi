import { storedScore } from '@bevi/ranking';
import { ApiError, isApiError, type Bucket, type SubmitRankingInput, type SubmitRankingResult, type ValidationErrorDetail } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBev, useMe, usePlacementList, useRerankBev, useSubmitRanking } from '@/api/hooks';
import { bevArtForCategory } from '@/components/BevArt';
import { BevGlow } from '@/components/BevGlow';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { useBack } from '@/lib/useBack';
import { nextCandidates, selectDone, selectPrompt, useRankingFlow, type RankingMode } from '@/state/rankingFlow';
import { motion, spacing, useTheme } from '@/theme';

import { Compare } from './Compare';
import { CONFLICT_NOTICE, VALIDATION_NOTICE } from './copy';
import { DiscardSheet } from './DiscardSheet';
import { GutCheck } from './GutCheck';
import { NoteStep } from './NoteStep';
import { RankResult } from './RankResult';

type Phase = 'gut' | 'loading' | 'compare' | 'note' | 'result';

export interface RankFlowProps {
  bevId: string;
  /** `?mode=rerank`. Also on when the Bev already has `myRanking`. */
  rerank?: boolean;
  /**
   * `?entry=search`: opened by tapping a search result before its ranked state was known. A Bev
   * you've already ranked opens its detail instead (§6.8: detail, with Re-rank there).
   */
  detailIfRanked?: boolean;
}

const flow = () => useRankingFlow.getState();

/**
 * The ranking flow (DEVELOPMENT-MATT §6.9): gut check → comparisons → note → result. Placement runs
 * locally in the `rankingFlow` store (`@bevi/ranking`); the bucket list is fetched once when the
 * bucket is chosen and again only to restart after a `conflict`. When the catalog's leaves load,
 * the search is anchored: like-for-like questions first (M-21, `usePlacementList`).
 */
export function RankFlow({ bevId, rerank = false, detailIfRanked = false }: RankFlowProps) {
  const back = useBack();
  const router = useRouter();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const bevQ = useBev(bevId);
  const me = useMe();
  const submit = useSubmitRanking();
  const rerankBev = useRerankBev();

  const placement = useRankingFlow((s) => s.placement);
  const orderedIds = useRankingFlow((s) => s.orderedIds);
  const note = useRankingFlow((s) => s.note);
  const prompt = useMemo(() => selectPrompt({ placement }), [placement]);
  const upcoming = useMemo(() => nextCandidates(placement), [placement]);
  // Prefetch both Bevs the next question could show, so the swap doesn't wait on the network.
  useBev(upcoming[0]);
  useBev(upcoming[1]);

  const [phase, setPhase] = useState<Phase>('gut');
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [noteError, setNoteError] = useState<string | undefined>();
  const [fatal, setFatal] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<SubmitRankingResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  // The list to search, with its anchoring tiers when the catalog has them (M-21; never blocks).
  const bucketQ = usePlacementList(bucket ?? undefined, bevQ.data);
  const mode: RankingMode = rerank || !!bevQ.data?.myRanking ? 'rerank' : 'new';

  const toDetail = detailIfRanked && !rerank && !!bevQ.data?.myRanking;
  useEffect(() => {
    if (toDetail) router.replace({ pathname: '/bev/[id]', params: { id: bevId } });
  }, [toDetail, router, bevId]);

  // A fresh flow per visit; nothing survives leaving the screen.
  useEffect(() => {
    flow().reset();
    return () => flow().reset();
  }, [bevId]);

  // Re-rank: start from the note already there (Save replaces it, Skip keeps it).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !bevQ.data) return;
    prefilled.current = true;
    const existing = bevQ.data.myRanking?.note;
    if (existing) flow().setNote(existing);
  }, [bevQ.data]);

  // Choosing a bucket pours it, then moves on.
  const pour = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pour.current), []);
  const choose = (b: Bucket) => {
    setBucket(b);
    clearTimeout(pour.current);
    pour.current = setTimeout(() => setPhase('loading'), reduced ? 0 : motion.pour);
  };

  // Start placement on a list fetched after the bucket was chosen (never a stale cached one).
  useEffect(() => {
    if (phase !== 'loading' || !bucket || !bevQ.data) return;
    if (!bucketQ.data || !bucketQ.isFetchedAfterMount || bucketQ.isFetching) return;
    flow().start(bevId, bucket, bucketQ.data.orderedIds, mode, bucketQ.data.tiers);
    setPhase(selectDone(flow()) ? 'note' : 'compare');
  }, [phase, bucket, bevId, bevQ.data, bucketQ.data, bucketQ.isFetchedAfterMount, bucketQ.isFetching, mode]);

  // The score the server will store, computed the moment placement finishes (the note step reveals it).
  // Recomputed for every finished placement: after Undo and forward again, and after a conflict restart.
  const placed = useMemo(() => {
    if (phase !== 'note' || !placement) return null;
    const r = flow().result();
    if (!r) return null;
    const bucketSize = r.expectedBucketSize + 1;
    return { bucket: r.bucket, position: r.insertIndex, bucketSize, score: storedScore(r.insertIndex, bucketSize, r.bucket) };
  }, [phase, placement]);

  // The last answer finishes placement: on to the note.
  useEffect(() => {
    if (phase === 'compare' && selectDone({ placement })) setPhase('note');
  }, [phase, placement]);

  const answerNew = useCallback(() => flow().answer('NEW_BETTER'), []);
  const answerExisting = useCallback(() => flow().answer('EXISTING_BETTER'), []);
  const tie = useCallback(() => flow().tie(), []);
  /** Pops one comparison; with none left, back to the gut check (the note is kept). */
  const undo = useCallback(() => {
    const p = flow().placement;
    if (p && p.history.length > 0) {
      flow().undo();
      setPhase('compare');
      return;
    }
    const kept = flow().note;
    flow().reset();
    flow().setNote(kept);
    setNotice(null);
    setPhase('gut');
  }, []);

  /** After a conflict (or an invalid placement): the latest list, placement from the top. */
  const restart = async (message: string, nextMode?: RankingMode) => {
    const fresh = await bucketQ.refetch();
    // A failed refetch keeps the old (stale) list in `data`: never restart on it.
    if (fresh.isError || !fresh.data) {
      setSaveError(fresh.error ?? new ApiError('unknown', 'Could not reload the list'));
      return;
    }
    flow().restart(fresh.data.orderedIds, nextMode, fresh.data.tiers);
    setNotice(message);
    setPhase(selectDone(flow()) ? 'note' : 'compare');
  };

  const onSaveError = async (e: unknown) => {
    if (!isApiError(e)) return setSaveError(e);
    switch (e.code) {
      case 'conflict': {
        // The bucket changed elsewhere, or the Bev was ranked elsewhere (then move it instead).
        // `detail.reason` is only a fast path (the FakeApi sends it; the contract doesn't promise it):
        // otherwise a new ranking re-reads the Bev and switches to re-rank if it now has myRanking.
        const reason = (e.detail as { reason?: string } | undefined)?.reason;
        if (reason === 'already_ranked') return restart(CONFLICT_NOTICE, 'rerank');
        if (flow().mode === 'new') {
          const bevNow = await bevQ.refetch();
          if (!bevNow.isError && bevNow.data?.myRanking) return restart(CONFLICT_NOTICE, 'rerank');
        }
        return restart(CONFLICT_NOTICE);
      }
      case 'validation':
        if ((e.detail as ValidationErrorDetail | undefined)?.field === 'note') return setNoteError(e.message);
        // An index out of range is a client bug: log it and place again on a fresh list.
        console.warn('[rank] placement rejected as invalid, restarting', e.detail);
        return restart(VALIDATION_NOTICE);
      case 'unauthorized':
      case 'not_found':
      case 'age_restricted':
        return setFatal(e);
      default:
        // Offline, rate limited, unknown: keep the placement and the note; Retry sends it again.
        return setSaveError(e);
    }
  };

  const save = async (withNote: boolean) => {
    const r = flow().result();
    if (!r) return;
    const { mode: m, note: n } = flow();
    const text = n.trim();
    const input: SubmitRankingInput = {
      bevId: r.bevId,
      bucket: r.bucket,
      insertIndex: r.insertIndex,
      expectedBucketSize: r.expectedBucketSize,
      comparisons: r.comparisons,
      // A new ranking sends a note only when there is one; a re-rank sends it to replace (or clear) the old one.
      ...(withNote && (text || m === 'rerank') ? { note: text } : {}),
    };
    setSaveError(null);
    setNoteError(undefined);
    try {
      const res = await (m === 'rerank' ? rerankBev : submit).mutateAsync(input);
      setOutcome(res);
      setNotice(null);
      setPhase('result');
    } catch (e) {
      await onSaveError(e);
    }
  };

  const leave = () => {
    setConfirm(false);
    flow().reset();
    back();
  };
  const close = () => (bucket && phase !== 'result' && !fatal ? setConfirm(true) : leave());

  const bev = bevQ.data;
  const restricted = !!bev && !!me.data && !me.data.canSeeAlcohol && !!categoryById(bev.categoryId)?.isAlcoholic;
  const blocking = fatal ?? bevQ.error ?? (restricted ? new ApiError('age_restricted', 'Not available') : null);

  let content;
  if (blocking) {
    content = (
      <Screen>
        <Header actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: leave }]} />
        <ErrorState error={blocking} onRetry={fatal ? undefined : () => void bevQ.refetch()} />
      </Screen>
    );
  } else if (!bev || toDetail) {
    content = (
      <Screen>
        <Header actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: leave }]} />
        <View style={styles.loading} accessibilityLabel="Loading" aria-busy>
          <Skeleton variant="circle" width={200} height={200} />
          <Skeleton variant="text" lines={2} width="60%" />
        </View>
      </Screen>
    );
  } else if (phase === 'gut' || phase === 'loading') {
    content =
      phase === 'loading' && bucketQ.isError ? (
        <Screen>
          <Header actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: close }]} />
          <ErrorState error={bucketQ.error} onRetry={() => void bucketQ.refetch()} />
        </Screen>
      ) : (
        <View style={[styles.fill, { backgroundColor: colors.surface }]}>
          <BevGlow color={bevArtForCategory(bev.categoryId).color} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.fill}>
            <GutCheck bev={bev} chosen={bucket} onChoose={choose} onClose={close} />
          </SafeAreaView>
        </View>
      );
  } else if (phase === 'compare' && prompt && bucket) {
    content = (
      <Screen>
        <Compare
          bev={bev}
          bucket={bucket}
          prompt={prompt}
          orderedIds={orderedIds}
          notice={notice}
          keysEnabled={!confirm}
          onNewBetter={answerNew}
          onExistingBetter={answerExisting}
          onTie={tie}
          onUndo={undo}
          onClose={close}
        />
      </Screen>
    );
  } else if (phase === 'note' && placement && placed) {
    content = (
      <Screen>
        <NoteStep
          bucket={placed.bucket}
          score={placed.score}
          position={placed.position}
          bucketSize={placed.bucketSize}
          note={note}
          onNoteChange={(v) => flow().setNote(v)}
          onSave={() => void save(true)}
          onSkip={() => void save(false)}
          onUndo={placement.history.length > 0 ? undo : undefined}
          onClose={close}
          saving={submit.isPending || rerankBev.isPending}
          error={saveError}
          noteError={noteError}
          notice={notice}
        />
      </Screen>
    );
  } else if (phase === 'result' && outcome) {
    content = (
      <Screen>
        <RankResult bevName={bev.name} result={outcome} onDone={leave} />
      </Screen>
    );
  }

  return (
    <>
      {content}
      <DiscardSheet open={confirm} onDiscard={leave} onKeep={() => setConfirm(false)} />
    </>
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
  loading: { alignItems: 'center', gap: spacing.lg, padding: spacing.gutter },
});

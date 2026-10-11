import {
  answer as answerPlacement,
  currentPrompt,
  isDone,
  placementResult,
  startPlacement,
  undo as undoPlacement,
  type ComparisonAnswer,
  type PlacementPrompt,
  type PlacementResult,
  type PlacementState,
} from '@bevi/ranking';
import type { Bucket } from '@bevi/shared';
import { create } from 'zustand';

/** 'new' calls `submitRanking`; 'rerank' moves an existing ranking with `rerankBev`. */
export type RankingMode = 'new' | 'rerank';

/** Notes are up to 140 characters (`SubmitRankingInput.note`). */
export const NOTE_MAX = 140;

export interface RankingFlowState {
  mode: RankingMode;
  /** The `@bevi/ranking` placement machine; null before `start` and after `reset`. */
  placement: PlacementState | null;
  /** The bucket list as fetched, best first (it may still contain the Bev on a re-rank). */
  orderedIds: readonly string[];
  note: string;

  /** Begin placing `bevId` into `bucket`. An empty list is done at once (insert at 0). Keeps the note. */
  start: (bevId: string, bucket: Bucket, orderedIds: readonly string[], mode: RankingMode) => void;
  /** Same Bev and bucket, a fresh list (after a `conflict`): placement starts over, the note stays. */
  restart: (orderedIds: readonly string[], mode?: RankingMode) => void;
  answer: (a: ComparisonAnswer) => void;
  /** "Too close to call". */
  tie: () => void;
  undo: () => void;
  setNote: (note: string) => void;
  /** What `submitRanking` / `rerankBev` sends (minus the note), or null until placement is done. */
  result: () => PlacementResult | null;
  reset: () => void;
}

const INITIAL = { mode: 'new' as RankingMode, placement: null, orderedIds: [] as readonly string[], note: '' };

/**
 * The ranking flow (the app's second Zustand store, DEVELOPMENT-MATT §3). A thin holder for the
 * `@bevi/ranking` placement machine: every transition is the package's, never reimplemented here.
 */
export const useRankingFlow = create<RankingFlowState>()((set, get) => ({
  ...INITIAL,
  start: (bevId, bucket, orderedIds, mode) =>
    set({ mode, orderedIds, placement: startPlacement({ bevId, bucket, orderedBevIds: orderedIds }) }),
  restart: (orderedIds, mode) => {
    const { placement } = get();
    if (!placement) return;
    set((s) => ({
      mode: mode ?? s.mode,
      orderedIds,
      placement: startPlacement({ bevId: placement.bevId, bucket: placement.bucket, orderedBevIds: orderedIds }),
    }));
  },
  answer: (a) => {
    const { placement } = get();
    if (placement && !isDone(placement)) set({ placement: answerPlacement(placement, a) });
  },
  tie: () => get().answer('TIE'),
  undo: () => {
    const { placement } = get();
    if (placement) set({ placement: undoPlacement(placement) });
  },
  setNote: (note) => set({ note: note.slice(0, NOTE_MAX) }),
  result: () => {
    const { placement } = get();
    return placement && isDone(placement) ? placementResult(placement) : null;
  },
  reset: () => set(INITIAL),
}));

/** The question on screen, or null when placement is done (or not started). */
export function selectPrompt(s: Pick<RankingFlowState, 'placement'>): PlacementPrompt | null {
  return s.placement ? currentPrompt(s.placement) : null;
}

export function selectDone(s: Pick<RankingFlowState, 'placement'>): boolean {
  return !!s.placement && isDone(s.placement);
}

/**
 * The two Bevs that could be asked about next (after "new is better" and "existing is better"), so
 * the screen can prefetch them. Uses the package's own transitions.
 */
export function nextCandidates(placement: PlacementState | null): string[] {
  if (!placement || isDone(placement)) return [];
  return (['NEW_BETTER', 'EXISTING_BETTER'] as const)
    .map((a) => currentPrompt(answerPlacement(placement, a))?.comparedBevId)
    .filter((id): id is string => !!id);
}

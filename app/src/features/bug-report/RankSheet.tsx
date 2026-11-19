import { answer, currentPrompt, isDone, placementResult, startPlacement, undo, type PlacementState } from '@bevi/ranking';
import { isApiError, type BugReportSummary } from '@bevi/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMyBugReports, usePlaceBug } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { actionErrorMessage, errorCopy } from '@/lib/errorCopy';
import { formatRelativeTime } from '@/lib/time';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { KIND_LABEL, openInRankOrder, priorityLabel } from './labels';
import { REPORT_UI } from './ReportLayer';
import { closeSheet, finishRanking, useReport } from './store';

/** How long "Placed #3 of 12 · High" stays before the next ticket. */
const PLACED_MS = 1200;

/**
 * Which is worse? Places a filed ticket in the tester's own ranked list (worst first) with the
 * app's own pairwise comparison: `@bevi/ranking`'s placement state machine, exactly as ranking a
 * Bev uses it. Never asked for at send time; the tester comes here from the toast, the reports
 * sheet's banner or a row's Place.
 *
 * Mapping the machine onto a worst-first list: the machine's list is "best first" and "better"
 * means higher in it, so here "better" means worse (nearer the top). Pressing the new report as
 * the worse one is NEW_BETTER; pressing the one already ranked is EXISTING_BETTER.
 */
export function RankSheet() {
  const open = useReport((s) => s.sheet === 'rank');
  const ticketId = useReport((s) => (s.sheet === 'rank' ? s.rankQueue[0] : undefined));
  return (
    <Sheet open={open} title="Which is worse?" snap={90} onClose={closeSheet}>
      {open && ticketId ? <Placement key={ticketId} ticketId={ticketId} /> : null}
    </Sheet>
  );
}

type Done = { kind: 'placed'; rank: number | null; of: number; priority: string | null } | null;

function Placement({ ticketId }: { ticketId: string }) {
  const { colors } = useTheme();
  const query = useMyBugReports();
  const place = usePlaceBug();
  const outboxTitle = useReport((s) => s.outbox.find((o) => o.result?.ticketId === ticketId)?.title);
  const [done, setDone] = useState<Done>(null);

  // The comparison list is fixed when the placement starts, so a refetch mid-way can't move it.
  const rows = query.data;
  const self = rows?.find((r) => r.ticketId === ticketId);
  const others = useMemo(() => openInRankOrder(rows).filter((r) => r.ticketId !== ticketId), [rows, ticketId]);
  const [state, setState] = useState<PlacementState | null>(null);
  const started = useRef(false);
  const lastIndex = useRef(0);
  const placedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Placed #3 of 12" waits a moment before the next ticket. Unmounted before that (the sheet
  // closed), the wait is cancelled; the ticket is placed all the same, so it leaves the list to place.
  useEffect(
    () => () => {
      if (!placedTimer.current) return;
      clearTimeout(placedTimer.current);
      placedTimer.current = null;
      finishRanking(ticketId, true);
    },
    [ticketId],
  );
  const fetching = query.isFetching;

  useEffect(() => {
    if (started.current || !rows) return;
    // Just filed: the list may still be catching up with it.
    if (!self && fetching) return;
    started.current = true;
    // Nothing to compare it with, or it isn't open any more: nothing to place.
    if (!self || self.state === 'unknown' || others.length === 0 || !['triage', 'todo', 'in_progress'].includes(self.state)) {
      finishRanking(ticketId, true);
      return;
    }
    // The bucket means nothing here (tickets have no buckets); the machine needs one, and any will do.
    setState(startPlacement({ bevId: ticketId, bucket: 'FINE', orderedBevIds: others.map((r) => r.ticketId) }));
  }, [rows, self, others, ticketId, fetching]);

  const submit = (s: PlacementState, index: number) => {
    lastIndex.current = index;
    const afterTicketId = index === 0 ? null : (s.list[index - 1] ?? null);
    place.mutate(
      { ticketId, afterTicketId },
      {
        onSuccess: (list) => {
          const placed = list.find((r) => r.ticketId === ticketId);
          setDone({ kind: 'placed', rank: placed?.rank ?? index + 1, of: openInRankOrder(list).length, priority: priorityLabel(placed?.priority) });
          placedTimer.current = setTimeout(() => {
            placedTimer.current = null;
            finishRanking(ticketId, true);
          }, PLACED_MS);
        },
      },
    );
  };

  const choose = (a: 'NEW_BETTER' | 'EXISTING_BETTER' | 'TIE') => {
    if (!state || isDone(state)) return;
    const next = answer(state, a);
    setState(next);
    if (isDone(next)) submit(next, placementResult(next).insertIndex);
  };

  // A deliberate early stop, not a placement of our own: the machine has narrowed the ticket to
  // the insertion range [lo, hi]; it goes in the middle of what is left.
  const goodEnough = () => {
    if (!state) return;
    submit(state, Math.floor((state.lo + state.hi) / 2));
  };

  if (query.isPending || (!state && !query.isError)) {
    return (
      <View style={styles.body} {...REPORT_UI} accessibilityLabel="Loading your reports" aria-busy>
        <Skeleton variant="block" height={size.rowMin} />
        <Skeleton variant="block" height={size.rowMin} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={styles.body} {...REPORT_UI}>
        <Failure error={query.error} onRetry={() => void query.refetch()} />
      </View>
    );
  }
  if (!state) return null;

  if (done) {
    return (
      <View style={styles.body} {...REPORT_UI}>
        <Text style={[type.screenTitle, styles.center, { color: colors.text }]} accessibilityLiveRegion="polite">
          {[`Placed #${done.rank ?? '?'} of ${done.of}`, done.priority].filter(Boolean).join(' · ')}
        </Text>
      </View>
    );
  }

  const prompt = currentPrompt(state);
  const incumbent = prompt ? rows?.find((r) => r.ticketId === prompt.comparedBevId) : undefined;
  // Where it sits in the list being searched (fixed when the placement started).
  const incumbentRank = prompt ? state.list.indexOf(prompt.comparedBevId) + 1 : 0;
  const unsupported = place.isError && isPlaceUnsupported(place.error);

  return (
    <View style={styles.body} {...REPORT_UI}>
      {unsupported ? (
        <View role="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={[type.body, { color: colors.text }]}>Ranking turns on when the server is updated. Your report is filed.</Text>
          <Button onPress={closeSheet}>Close</Button>
        </View>
      ) : place.isError ? (
        <View role="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={[type.heading, { color: colors.scoreLow }]}>{errorCopy(place.error).title}</Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>{actionErrorMessage(place.error)}</Text>
          <Button
            onPress={() => {
              place.reset();
              submit(state, lastIndex.current);
            }}
          >
            Try again
          </Button>
        </View>
      ) : null}

      {prompt && incumbent && !place.isPending && !place.isError ? (
        <>
          <TicketCard
            title={self?.title ?? outboxTitle ?? ticketId}
            row={self}
            ticketId={ticketId}
            tag="New"
            onPress={() => choose('NEW_BETTER')}
          />
          <TicketCard
            title={incumbent.title}
            row={incumbent}
            ticketId={incumbent.ticketId}
            tag={`#${incumbentRank} of ${state.list.length}`}
            onPress={() => choose('EXISTING_BETTER')}
          />
          <Text style={[type.caption, styles.center, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {`Question ${prompt.step} of at most ${prompt.maxSteps}`}
          </Text>
          <Button block onPress={() => choose('TIE')}>
            About the same
          </Button>
          <View style={styles.actions}>
            {state.history.length ? (
              <Button variant="ghost" icon="undo-2" onPress={() => setState(undo(state))}>
                Undo
              </Button>
            ) : null}
            <Button variant="ghost" onPress={goodEnough}>
              Good enough
            </Button>
            <Button variant="ghost" onPress={() => finishRanking(ticketId, false)}>
              Skip
            </Button>
          </View>
        </>
      ) : place.isPending ? (
        <Button variant="primary" block loading>
          Placing
        </Button>
      ) : null}
    </View>
  );
}

/** The deployed server predates `bugs.place`. */
function isPlaceUnsupported(error: unknown): boolean {
  if (!isApiError(error)) return false;
  const detail = error.detail as { reason?: unknown } | undefined;
  return detail?.reason === 'place_unsupported';
}

function TicketCard({
  title,
  row,
  ticketId,
  tag,
  onPress,
}: {
  title: string;
  row: BugReportSummary | undefined;
  ticketId: string;
  tag: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const meta = [ticketId, row ? KIND_LABEL[row.kind] : null, row ? formatRelativeTime(row.createdAt) : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}, ${tag}. Press if this one is worse.`}
      style={({ pressed }) => [styles.card, { borderColor: colors.borderStrong, backgroundColor: colors.surface }, pressed && { backgroundColor: colors.input }]}
    >
      <View style={[styles.tag, { backgroundColor: colors.primaryTint }]}>
        <Text style={[type.caption, styles.tagText, { color: colors.primary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {tag}
        </Text>
      </View>
      <Text style={[type.heading, { color: colors.text }]} numberOfLines={3}>
        {title}
      </Text>
      <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {meta}
      </Text>
    </Pressable>
  );
}

function Failure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { colors } = useTheme();
  const copy = errorCopy(error);
  return (
    <View role="alert" accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={[type.heading, { color: colors.scoreLow }]}>{copy.title}</Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>{copy.message}</Text>
      {copy.retry ? <Button onPress={onRetry}>Try again</Button> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl, gap: spacing.md },
  center: { textAlign: 'center' },
  notice: { gap: spacing.sm },
  card: { gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderRadius: radius.card, minHeight: size.rowMin },
  tag: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  tagText: { fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm },
});

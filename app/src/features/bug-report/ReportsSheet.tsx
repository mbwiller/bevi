import type { BugReportSummary } from '@bevi/shared';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCanRankBug, useMarkBugVerified, useMyBugReports } from '@/api/hooks';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { actionErrorMessage, errorCopy } from '@/lib/errorCopy';
import { openLink } from '@/lib/openLink';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { byNewest, byRank, isOpen, ticketMeta } from './labels';
import { REPORT_UI } from './ReportLayer';
import { closeSheet, openRank, retrySend, useReport, type OutboxItem, type Sender } from './store';

/**
 * Filed reports: the tickets already filed from this account (not drafts in progress): what is still sending, what is waiting to be placed, and every ticket filed from
 * this account by where it is in the workflow (docs/bug-workflow.md). For a founder (who may rank,
 * `bugs.canRank()`), open tickets are in their own rank order, each with Place to move it, and a
 * row opens the ticket on the board. A tester does not rank and has no board login: their open
 * tickets are newest first, with no rank, no Place and no link. In review ones are where the
 * reporter checks the fix on the device and says so; closed ones are folded away.
 */
export function ReportsSheet({ sender }: { sender: Sender }) {
  const open = useReport((s) => s.sheet === 'reports');
  return (
    <Sheet open={open} title="Filed reports" snap={90} onClose={closeSheet}>
      {open ? <ReportsBody sender={sender} /> : null}
    </Sheet>
  );
}

function ReportsBody({ sender }: { sender: Sender }) {
  const { colors } = useTheme();
  const query = useMyBugReports();
  // Until the answer is in, no ranking is offered: a tester must never see Place, even for a moment.
  const canRank = useCanRankBug().data === true;
  const outbox = useReport((s) => s.outbox);
  const unplaced = useReport((s) => s.unplaced);
  const [closedOpen, setClosedOpen] = useState(false);
  const pending = outbox.filter((o) => o.status !== 'sent');

  const rows = query.data ?? [];
  const review = rows.filter((r) => r.state === 'in_review');
  const closed = rows.filter((r) => r.state === 'done' || r.state === 'canceled');
  // Everything else is Open, so no row is ever dropped: open states, 'unknown', and whatever a
  // server that predates ranking answers (every rank null). Unranked rows sort newest first, and
  // for an account that may not rank every row is.
  const openRows = rows.filter((r) => !review.includes(r) && !closed.includes(r)).sort(canRank ? byRank : byNewest);
  const openIds = new Set(rows.filter(isOpen).map((r) => r.ticketId));
  const toPlace = canRank ? unplaced.filter((id) => openIds.has(id)) : [];

  return (
    <View style={styles.body} {...REPORT_UI}>
      {pending.map((item) => (
        <OutboxRow key={item.key} item={item} onRetry={() => void retrySend(item.key, sender)} />
      ))}

      {toPlace.length > 0 && openIds.size > 1 ? (
        <Pressable
          onPress={() => openRank(toPlace)}
          accessibilityRole="button"
          accessibilityLabel={toPlace.length === 1 ? 'Place 1 report' : `Place ${toPlace.length} reports`}
          style={({ pressed }) => [styles.banner, { backgroundColor: colors.primaryTint }, pressed && { opacity: 0.7 }]}
        >
          <Icon name="arrow-up-down" size={20} strokeWidth={2} color={colors.primary} />
          <Text style={[type.heading, styles.grow, { color: colors.primary }]}>
            {toPlace.length === 1 ? 'Place 1 report' : `Place ${toPlace.length} reports`}
          </Text>
          <Icon name="chevron-right" size={18} strokeWidth={2} color={colors.primary} />
        </Pressable>
      ) : null}

      {query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Loading your reports" aria-busy>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="block" height={size.rowMin / 2} />
          <Skeleton variant="block" height={size.rowMin / 2} />
        </View>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 && pending.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="Nothing filed yet"
          body={canRank ? 'Reports you send show up here with their status and where you ranked them.' : 'Reports you send show up here with their status.'}
        />
      ) : (
        <>
          {openRows.length ? (
            <Section title="Open">
              {openRows.map((row) => (
                <TicketRow key={row.ticketId} row={row} canRank={canRank} placeable={canRank && isOpen(row) && openIds.size > 1} />
              ))}
            </Section>
          ) : null}
          {review.length ? (
            <Section title="In review">
              {review.map((row) => (
                <TicketRow key={row.ticketId} row={row} canRank={canRank}>
                  <VerifyButton ticketId={row.ticketId} />
                </TicketRow>
              ))}
            </Section>
          ) : null}
          {closed.length ? (
            <View>
              <Pressable
                onPress={() => setClosedOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={`Closed, ${closed.length}`}
                aria-expanded={closedOpen}
                style={styles.sectionHead}
              >
                <Text style={[type.sectionCaps, styles.grow, { color: colors.textSecondary }]}>{`Closed (${closed.length})`}</Text>
                <Icon name={closedOpen ? 'chevron-down' : 'chevron-right'} size={18} strokeWidth={2} color={colors.textSecondary} />
              </Pressable>
              {closedOpen ? closed.map((row) => <TicketRow key={row.ticketId} row={row} canRank={canRank} />) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]} role="heading" aria-level={2}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function OutboxRow({ item, onRetry }: { item: OutboxItem; onRetry: () => void }) {
  const { colors } = useTheme();
  const failed = item.status === 'failed';
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} accessibilityLiveRegion="polite">
      <View style={styles.grow}>
        <Text style={[type.body, { color: colors.text }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[type.caption, { color: failed ? colors.scoreLow : colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {failed ? `Didn't send. ${errorCopy(item.error).title}.` : 'Sending…'}
        </Text>
      </View>
      {failed ? <Button onPress={onRetry} accessibilityLabel={`Try again: ${item.title}`}>Try again</Button> : null}
    </View>
  );
}

/**
 * One ticket. For a founder (`canRank`) the row is a link to the ticket on the board and carries
 * its rank; a tester has no board login, so for them it is plain text (the ticket id is in the
 * meta line) with no rank.
 */
function TicketRow({
  row,
  canRank,
  placeable = false,
  children,
}: {
  row: BugReportSummary;
  canRank: boolean;
  placeable?: boolean;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const rank = canRank ? row.rank : null;
  const label = `${rank ? `Number ${rank}, ` : ''}${row.title}, ${ticketMeta(row)}`;
  const content = (
    <>
      {rank ? (
        <Text style={[type.heading, styles.rank, { color: colors.primary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {`#${rank}`}
        </Text>
      ) : null}
      <View style={styles.grow}>
        <Text style={[type.body, { color: colors.text }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {row.title}
        </Text>
        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {ticketMeta(row)}
        </Text>
      </View>
    </>
  );
  return (
    <View style={[styles.ticket, { borderBottomColor: colors.border }]}>
      <View style={styles.ticketTop}>
        {canRank ? (
          <Pressable
            onPress={() => openLink(() => Linking.openURL(row.ticketUrl))}
            accessibilityRole="link"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.ticketMain, pressed && { opacity: 0.7 }]}
          >
            {content}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={label} style={styles.ticketMain}>
            {content}
          </View>
        )}
        {placeable ? <IconButton icon="arrow-up-down" label={`Place ${row.ticketId}`} size={22} onPress={() => openRank([row.ticketId])} /> : null}
      </View>
      {children}
    </View>
  );
}

/** Moves the ticket to Done, after asking once: the one state change a person makes, on the device. */
function VerifyButton({ ticketId }: { ticketId: string }) {
  const { colors } = useTheme();
  const verify = useMarkBugVerified();
  const [asking, setAsking] = useState(false);
  if (verify.isError) {
    return (
      <View style={styles.verify} role="alert" accessibilityLiveRegion="polite">
        <Text style={[type.caption, styles.grow, { color: colors.scoreLow }]}>{`Couldn't mark it verified. ${actionErrorMessage(verify.error)}`}</Text>
        <Button onPress={() => verify.mutate(ticketId)} accessibilityLabel={`Try again: verify ${ticketId}`}>
          Try again
        </Button>
      </View>
    );
  }
  if (asking) {
    return (
      <View style={styles.verify} accessibilityLiveRegion="polite">
        <Text style={[type.body, styles.grow, { color: colors.text }]}>{"Checked on this device and it's fixed?"}</Text>
        <Button variant="ghost" onPress={() => setAsking(false)}>
          Not yet
        </Button>
        <Button loading={verify.isPending} onPress={() => verify.mutate(ticketId)} accessibilityLabel={`Yes, ${ticketId} is fixed`}>
          {"Yes, it's fixed"}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.verify}>
      <Button icon="circle-check" onPress={() => setAsking(true)} accessibilityLabel={`Verified on device: ${ticketId}`}>
        Verified on device
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl, gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  loading: { gap: spacing.md, paddingTop: spacing.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: size.target + spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.card,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: size.target, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1 },
  ticket: { paddingVertical: spacing.sm, borderBottomWidth: 1, gap: spacing.sm },
  ticketTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ticketMain: { flex: 1, minWidth: 0, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rank: { minWidth: size.target, fontVariant: ['tabular-nums'] },
  verify: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});

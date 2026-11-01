import { isApiError, type BevSummary } from '@bevi/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBevSearch, useReportBev } from '@/api/hooks';
import { BevImage } from '@/components/BevImage';
import { bevImageProps, brandLine } from '@/components/BevParts';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { SheetOption } from '@/features/lists/SheetOption';
import { errorCopy } from '@/lib/errorCopy';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

/**
 * Report reasons. The contract takes a free `reason` string (`bevs.report(id, reason)`) and lists no
 * values, so the app sends these ids; the labels are the interface copy.
 */
export const REPORT_REASONS = [
  { id: 'wrong_info', label: 'Wrong name or brand' },
  { id: 'wrong_category', label: 'Wrong category' },
  { id: 'bad_photo', label: 'Bad or missing photo' },
  { id: 'duplicate', label: 'Duplicate of another Bev' },
  { id: 'not_a_drink', label: 'Not a drink' },
  { id: 'other', label: 'Something else' },
] as const;

/** Characters before the duplicate search runs. */
const MIN_QUERY = 2;
/** Results listed in the duplicate search. */
const RESULT_LIMIT = 8;
/** A search returns the reported Bev too; one extra result makes up for dropping it. */
const FETCH_LIMIT = RESULT_LIMIT + 1;
const THUMB = 40;

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

/** The server rejects a duplicate that is the Bev itself or one the viewer can't see (`validation`, field `duplicateOfId`). */
function isDuplicateOfError(error: unknown): boolean {
  if (!isApiError(error) || error.code !== 'validation') return false;
  const detail = error.detail as { field?: unknown } | undefined;
  return detail?.field === 'duplicateOfId';
}

/**
 * Report Bev (§6.19): pick a reason, submit, then a thank-you. "Duplicate of another Bev" adds a step
 * that asks which Bev (M-20) and sends it as `duplicateOfId`.
 */
export function ReportSheet({ bevId, name, open, onClose }: { bevId: string; name: string; open: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [step, setStep] = useState<'reason' | 'duplicate'>('reason');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const report = useReportBev();

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setStep('reason');
    setQuery('');
    setPicked(null);
    report.reset();
  }, [open]);

  const choosingDuplicate = reason === 'duplicate';
  const onDuplicateStep = step === 'duplicate' && choosingDuplicate;

  const title = report.isSuccess
    ? 'Thanks for the report'
    : onDuplicateStep
      ? 'Which Bev is it a duplicate of?'
      : `Report ${name}`;

  const failure = report.error
    ? isDuplicateOfError(report.error)
      ? 'Pick a different Bev to report this one as a duplicate of.'
      : errorCopy(report.error).message
    : null;

  return (
    <Sheet open={open} title={title} snap={90} onClose={onClose}>
      {report.isSuccess ? (
        <View style={styles.pad}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>We'll take a look and fix it if something's off.</Text>
          <Button variant="primary" block onPress={onClose}>
            Done
          </Button>
        </View>
      ) : onDuplicateStep ? (
        <>
          <DuplicatePicker
            reportedId={bevId}
            query={query}
            onQuery={setQuery}
            picked={picked}
            onPick={(id) => {
              setPicked(id);
              report.reset();
            }}
          />
          <View style={styles.pad}>
            {failure ? (
              <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
                {failure}
              </Text>
            ) : null}
            <Button variant="outlined" block disabled={report.isPending} onPress={() => setStep('reason')}>
              Back
            </Button>
            <Button
              variant="primary"
              block
              disabled={!picked}
              loading={report.isPending}
              onPress={() => picked && report.mutate({ bevId, reason: 'duplicate', duplicateOfId: picked })}
            >
              Send report
            </Button>
          </View>
        </>
      ) : (
        <>
          {REPORT_REASONS.map((r) => (
            <SheetOption key={r.id} label={r.label} selected={reason === r.id} onPress={() => setReason(r.id)} />
          ))}
          <View style={styles.pad}>
            {failure ? (
              <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
                {failure}
              </Text>
            ) : null}
            <Button
              variant="primary"
              block
              disabled={!reason}
              loading={report.isPending}
              onPress={() => {
                if (!reason) return;
                if (choosingDuplicate) {
                  report.reset();
                  setStep('duplicate');
                } else {
                  report.mutate({ bevId, reason });
                }
              }}
            >
              {choosingDuplicate ? 'Next' : 'Send report'}
            </Button>
          </View>
        </>
      )}
    </Sheet>
  );
}

/** Search inside the sheet for the Bev the reported one duplicates. Never lists the reported Bev. */
function DuplicatePicker({
  reportedId,
  query,
  onQuery,
  picked,
  onPick,
}: {
  reportedId: string;
  query: string;
  onQuery: (q: string) => void;
  picked: string | null;
  onPick: (id: string) => void;
}) {
  const { colors } = useTheme();
  const ready = query.trim().length >= MIN_QUERY;
  const search = useBevSearch(query.trim(), undefined, { enabled: ready, limit: FETCH_LIMIT });
  const results = ready ? (search.data?.items ?? []).filter((b) => b.id !== reportedId).slice(0, RESULT_LIMIT) : [];

  return (
    <View>
      <View style={styles.search}>
        <SearchBar variant="filled" autoFocus placeholder="Search a Bev, brand or flavor" value={query} onChange={onQuery} />
      </View>
      {!ready ? (
        <Text style={[type.body, styles.hint, { color: colors.textSecondary }]}>Type at least two letters</Text>
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : search.isPending || (search.isPlaceholderData && search.isFetching && results.length === 0) ? (
        <>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </>
      ) : results.length === 0 ? (
        <EmptyState icon="search" title="No Bevs match" body="Try the brand or the flavour." />
      ) : (
        results.map((bev) => <PickRow key={bev.id} bev={bev} selected={picked === bev.id} onPress={() => onPick(bev.id)} />)
      )}
    </View>
  );
}

/** A compact, selectable Bev: a 40pt image, name, "Brand · Flavor" and a check once picked. */
function PickRow({ bev, selected, onPress }: { bev: BevSummary; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const line = brandLine(bev);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pick ${bev.name}`}
      accessibilityState={{ selected }}
      {...({ 'aria-pressed': selected } as object)}
      onPress={onPress}
      style={({ pressed }) => [styles.pick, { borderBottomColor: colors.border }, pressed && PRESSED]}
    >
      <BevImage size={THUMB} {...bevImageProps(bev)} />
      <View style={styles.pickText}>
        <Text {...DENSE} style={[type.bodyLarge, { color: colors.text }]} numberOfLines={1}>
          {bev.name}
        </Text>
        {line ? (
          <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
            {line}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={22} strokeWidth={2} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, gap: spacing.lg },
  search: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  hint: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.md },
  pick: {
    minHeight: size.target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  pickText: { flex: 1, minWidth: 0 },
});

import type { BevSummary } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';

import { BevRow } from '@/components/BevRow';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { spacing, type, useTheme } from '@/theme';

import { PROCESSING_PHOTO } from './copy';

export interface DuplicatesStepProps {
  duplicates: BevSummary[] | undefined;
  loading: boolean;
  /** `findLikelyDuplicates` failed: say so, and still allow creating. */
  checkFailed: boolean;
  onRetryCheck: () => void;
  onPick: (bev: BevSummary) => void;
  onCreate: () => void;
  creating: boolean;
  /** Waiting for the server to finish the photo before `create` can go through. */
  processing: boolean;
  /** A failed submit (offline, upload failed, still processing…): Retry keeps the form. */
  submitMessage: string | null;
  /** Offline: submit is blocked (the banner says why). */
  blocked: boolean;
}

/** Step 3: "Did you mean…?" from `findLikelyDuplicates`, then create. */
export function DuplicatesStep({
  duplicates,
  loading,
  checkFailed,
  onRetryCheck,
  onPick,
  onCreate,
  creating,
  processing,
  submitMessage,
  blocked,
}: DuplicatesStepProps) {
  const { colors } = useTheme();
  const list = duplicates ?? [];
  const some = list.length > 0;
  return (
    <View style={styles.body}>
      <View style={styles.intro}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
          {loading ? 'Checking Bevi…' : some ? 'Did you mean…?' : 'Looks new'}
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          {loading
            ? 'Looking for Bevs like yours.'
            : some
              ? 'If yours is here, tap it to rank it.'
              : checkFailed
                ? "Couldn't check for similar Bevs. You can still add yours."
                : 'Nothing like it on Bevi yet.'}
        </Text>
        {checkFailed && !loading ? (
          <Button variant="ghost" icon="refresh-cw" onPress={onRetryCheck} accessibilityLabel="Check again">
            Check again
          </Button>
        ) : null}
      </View>
      {loading ? (
        <View aria-busy accessibilityLabel="Loading">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : (
        list.map((b) => (
          <BevRow key={b.id} bev={b} showImage meta="This is it" onPress={() => onPick(b)} onRank={() => onPick(b)} />
        ))
      )}
      <View style={styles.footer}>
        {processing ? (
          <Text style={[type.body, styles.center, { color: colors.textSecondary }]} role="status" accessibilityLiveRegion="polite">
            {PROCESSING_PHOTO}
          </Text>
        ) : null}
        {submitMessage && !creating ? (
          <View style={styles.error} role="alert">
            <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.scoreLow} />
            <Text style={[type.body, styles.flex, { color: colors.text }]}>{submitMessage}</Text>
          </View>
        ) : null}
        <Button variant={some ? 'outlined' : 'primary'} size="lg" block loading={creating} disabled={blocked || loading} onPress={onCreate}>
          {submitMessage && !creating ? 'Retry' : some ? 'No, mine is different' : 'Add and rank it'}
        </Button>
      </View>
    </View>
  );
}

/** An exact duplicate already exists (`conflict` with `existingBevId`): offer it instead. */
export function ExistingBev({ bev, onRank, onEdit }: { bev: BevSummary | undefined; onRank: () => void; onEdit: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body}>
      <View style={styles.intro}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
          It&apos;s already on Bevi
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>A Bev with this name, brand, flavor and category exists. Rank that one.</Text>
      </View>
      {bev ? <BevRow bev={bev} showImage actions={false} onPress={onRank} /> : <Skeleton variant="row" />}
      <View style={styles.footer}>
        <Button variant="primary" size="lg" block onPress={onRank} disabled={!bev}>
          Rank it
        </Button>
        <Button variant="ghost" block onPress={onEdit}>
          Edit details
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingTop: spacing.lg },
  intro: { gap: spacing.sm, paddingHorizontal: spacing.gutter, alignItems: 'flex-start' },
  footer: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  center: { textAlign: 'center' },
  error: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});

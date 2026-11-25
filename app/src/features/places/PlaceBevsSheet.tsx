import type { RankedBev } from '@bevi/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSetVenue, useUnplacedRankings } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { BevRow } from '@/components/BevRow';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { formatShortDate } from '@/lib/time';
import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';

import {
  ADD_LOCATIONS,
  BACKFILL_NONE,
  DONE,
  SKIP,
  backfillProgress,
  backfillSummary,
  placedAnnouncement,
} from './copy';
import { PlacePickerBody } from './PlacePicker';

export interface PlaceBevsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The Map tab's "Add them" (BEV-22): the viewer's Bevs that have no place, one at a time, newest
 * first, without leaving the map. Each step is the Bev on top and the place picker under it, so
 * the place used last sits first under Recent and a run of Bevs from one shop is a tap each. A pick
 * saves and moves on; Skip moves on without saving; Done (or closing the sheet) stops, keeping
 * whatever was saved. The map and its "no location yet" line update behind it as places are added.
 *
 * The list is read once when the sheet opens and held while it is open, so a save (which refreshes
 * the rankings) never shifts the Bev on screen.
 */
export function PlaceBevsSheet({ open, onClose }: PlaceBevsSheetProps) {
  const { colors } = useTheme();
  const unplaced = useUnplacedRankings(open);
  const setVenue = useSetVenue();
  const [queue, setQueue] = useState<RankedBev[] | null>(null);
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [said, setSaid] = useState<string | null>(null);

  // Take the list once it is fresh for this opening (a cached answer from an earlier opening is
  // being refetched while `isFetching`).
  useEffect(() => {
    if (open && queue === null && unplaced.data && !unplaced.isFetching) setQueue(unplaced.data);
  }, [open, queue, unplaced.data, unplaced.isFetching]);

  const reset = () => {
    setQueue(null);
    setIndex(0);
    setPlaced(0);
    setSkipped(0);
    setSaid(null);
    setVenue.reset();
  };

  const current = queue ? (queue[index] ?? null) : null;
  const finished = queue !== null && index >= queue.length;

  const next = () => {
    setVenue.reset();
    setIndex((i) => i + 1);
  };

  const dense = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

  let body;
  if (queue === null && unplaced.error) {
    body = <ErrorState error={unplaced.error} onRetry={() => void unplaced.refetch()} />;
  } else if (queue === null) {
    body = (
      <View style={styles.pad} testID="place-bevs-loading">
        <Skeleton variant="row" />
        <Skeleton variant="text" lines={3} />
      </View>
    );
  } else if (finished || queue.length === 0) {
    body = (
      <View style={styles.end}>
        <Text style={[type.bodyLarge, styles.center, { color: colors.text }]}>
          {queue.length === 0 ? BACKFILL_NONE : backfillSummary(placed, skipped)}
        </Text>
        <Button variant="primary" block onPress={onClose}>
          {DONE}
        </Button>
      </View>
    );
  } else if (current) {
    body = (
      <>
        <View style={styles.bar}>
          <Text style={[type.body, styles.progress, { color: colors.textSecondary }]} {...dense}>
            {backfillProgress(index, queue.length)}
          </Text>
          <Button
            variant="ghost"
            disabled={setVenue.isPending}
            onPress={() => {
              setSkipped((n) => n + 1);
              next();
            }}
            accessibilityLabel={`${SKIP} ${current.bev.name}`}
          >
            {SKIP}
          </Button>
          <Button variant="ghost" disabled={setVenue.isPending} onPress={onClose}>
            {DONE}
          </Button>
        </View>
        <BevRow
          bev={current.bev}
          showImage
          score={current.score}
          bucket={current.bucket}
          meta={`Ranked ${formatShortDate(current.createdAt)}`}
          actions={false}
        />
        <PlacePickerBody
          active={open}
          resetKey={current.bevId}
          saving={setVenue.isPending}
          error={setVenue.error}
          onSelect={(venue) =>
            setVenue.mutate(
              { bevId: current.bevId, venueId: venue.id },
              {
                onSuccess: () => {
                  setPlaced((n) => n + 1);
                  setSaid(placedAnnouncement(current.bev.name, venue.name));
                  next();
                },
              },
            )
          }
        />
      </>
    );
  }

  return (
    <Sheet open={open} title={ADD_LOCATIONS} snap={90} onClose={onClose} onClosed={reset}>
      <Announce text={said} />
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
  },
  progress: { flex: 1 },
  end: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.xl, gap: spacing.xl },
  center: { textAlign: 'center' },
});

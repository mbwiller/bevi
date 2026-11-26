import { isApiError, type BevdPin, type BevdScope } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useBevdAt, useMe } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { ErrorState } from '@/components/ErrorState';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { formatShortDate } from '@/lib/time';
import { spacing, type, useTheme } from '@/theme';

import { PLACE_GONE, placeDetail } from './copy';

export interface BevdPlaceSheetProps {
  /** The venue whose pin was tapped; null closes the sheet. */
  venueId: string | null;
  scope: BevdScope;
  /** The tapped pin, so the sheet has its title before the Bevs load. */
  seed?: BevdPin | null;
  onClose: () => void;
}

/** "Ana": the first word of a display name, or the handle. */
const shortName = (p: { displayName: string; handle: string }) => p.displayName.trim().split(/\s+/)[0] || p.handle;

/**
 * What was had at one place (BEV-22): the sheet a pin or a place row opens. Each row is a Bev with
 * the score of whoever had it there and when; tapping it opens the Bev. Nothing left in scope (the
 * ranking was removed since the pins loaded) reads as that, not as an error.
 */
export function BevdPlaceSheet({ venueId, scope, seed = null, onClose }: BevdPlaceSheetProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe().data?.id;
  const at = useBevdAt(venueId, scope);
  const venue = at.data?.venue ?? (seed && seed.venue.id === venueId ? seed.venue : null);
  const detail = venue ? placeDetail(venue) : null;
  const gone = isApiError(at.error) && at.error.code === 'not_found';
  // The Bev a row asked to open. It opens once the sheet has gone (`onClosed`), never in the tick
  // that closes it: navigating under a Modal iOS is still dismissing can leave a blank screen.
  const openNext = useRef<string | null>(null);

  return (
    <Sheet
      open={!!venueId}
      title={venue?.name ?? ''}
      snap={40}
      onClose={onClose}
      onClosed={() => {
        const id = openNext.current;
        openNext.current = null;
        if (id) router.push({ pathname: '/bev/[id]', params: { id } });
      }}
    >
      {detail ? (
        <Text style={[type.body, styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}

      {at.isPending && venueId ? (
        <View testID="bevd-place-loading">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : null}

      {gone ? <Text style={[type.bodyLarge, styles.gone, { color: colors.textSecondary }]}>{PLACE_GONE}</Text> : null}
      {at.error && !gone ? <ErrorState error={at.error} onRetry={() => void at.refetch()} /> : null}

      {(at.data?.items ?? []).map(({ user, ranking }) => {
        const mine = user.id === me;
        return (
          <BevRow
            key={ranking.id}
            bev={ranking.bev}
            showImage
            score={ranking.score}
            // The bubble takes the bucket colour only for the viewer's own ranking.
            bucket={mine ? ranking.bucket : undefined}
            meta={`${mine ? 'You' : shortName(user)} · ${formatShortDate(ranking.createdAt)}`}
            onPress={() => {
              openNext.current = ranking.bev.id;
              onClose();
            }}
          />
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  detail: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm, textAlign: 'center' },
  gone: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.xl, textAlign: 'center' },
});

import { ApiError, type VenuePin } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useCallback } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { VenueRow } from '@/components/VenueRow';
import { useTheme } from '@/theme';

import { NO_SPOTS } from './MapNotice';
import { pinScore } from './pinContent';

const SKELETON_ROWS = 4;
const OFFLINE = new ApiError('network', 'offline: the pins query is paused');

export interface VenueListProps {
  /** The map's `useVenuesInView` answer: the venues in view, in the order `inView` returns them. */
  pins: {
    data: VenuePin[] | undefined;
    isError: boolean;
    error: unknown;
    isPending: boolean;
    fetchStatus: 'fetching' | 'paused' | 'idle';
    refetch: () => unknown;
  };
  onSelect: (pin: VenuePin) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The map's List view (§1c `List | Map`, `View List`): the venues in view as VenueRows, best first as
 * `inView` sorts them. A tap shows the venue on the map with its VenueSheet.
 */
export function VenueList({ pins, onSelect, style }: VenueListProps) {
  const { colors } = useTheme();
  const renderItem = useCallback(
    ({ item }: { item: VenuePin }) => {
      const { value, predicted } = pinScore(item);
      return (
        <VenueRow
          venue={item.venue}
          openNow={item.openNow}
          score={value}
          predicted={predicted}
          bevs={item.bevCount}
          onPress={() => onSelect(item)}
        />
      );
    },
    [onSelect],
  );

  let body;
  if (pins.isError && !pins.data) body = <ErrorState error={pins.error} onRetry={() => void pins.refetch()} />;
  else if (pins.fetchStatus === 'paused' && !pins.data) body = <ErrorState error={OFFLINE} onRetry={() => void pins.refetch()} />;
  else if (!pins.data)
    body = (
      <View accessibilityLabel="Loading spots" aria-busy>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} variant="row" />
        ))}
      </View>
    );
  else if (pins.data.length === 0) body = <EmptyState icon="map-pin" title={NO_SPOTS} body="Move the map or change the filters." />;
  else body = <FlashList data={pins.data} renderItem={renderItem} keyExtractor={(p) => p.venue.id} />;

  return (
    <View testID="venue-list" style={[{ backgroundColor: colors.surface }, style]}>
      {body}
    </View>
  );
}

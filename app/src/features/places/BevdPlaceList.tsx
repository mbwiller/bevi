import type { BevdPin } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text } from 'react-native';

import { spacing, type, useTheme } from '@/theme';

import { pinSubtitle } from './copy';
import { PlaceRow } from './PlaceRow';

export interface BevdPlaceListProps {
  pins: readonly BevdPin[];
  selectedId?: string | null;
  onSelect: (venueId: string) => void;
  /** A line above the rows, e.g. why this is a list and not a map. */
  note?: string;
}

/**
 * The places Bevs were had, as rows, most recent first (the order `venues.bevdMap` gives). It is the
 * Map tab wherever there is no live map: the native app until it has a map library, and the web.
 */
export function BevdPlaceList({ pins, selectedId = null, onSelect, note }: BevdPlaceListProps) {
  const { colors } = useTheme();
  return (
    <FlashList
      testID="bevd-place-list"
      data={pins as BevdPin[]}
      keyExtractor={(pin) => pin.venue.id}
      extraData={selectedId}
      ListHeaderComponent={
        note ? <Text style={[type.body, styles.note, { color: colors.textSecondary }]}>{note}</Text> : null
      }
      renderItem={({ item }) => (
        <PlaceRow
          name={item.venue.name}
          subtitle={pinSubtitle(item)}
          placeType={item.venue.placeType}
          selected={item.venue.id === selectedId}
          onPress={() => onSelect(item.venue.id)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.md },
});

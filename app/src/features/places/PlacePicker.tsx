import { isApiError, type ExternalPlace, type Venue } from '@bevi/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAddPlace, useRecentVenues, useSearchMorePlaces, useVenueSearch } from '@/api/hooks';
import { SearchBar } from '@/components/SearchBar';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { SheetOption, SheetSection } from '@/features/lists/SheetOption';
import { actionErrorMessage } from '@/lib/errorCopy';
import { spacing, type, useTheme } from '@/theme';

import {
  LOCATION_OFF,
  MORE_EMPTY,
  MORE_FAILED,
  MORE_LIMITED,
  MORE_PLACES,
  NEARBY,
  NO_MATCH,
  PICKER_HINT,
  PICKER_PLACEHOLDER,
  PICKER_TITLE,
  RECENT,
  REMOVE_LOCATION,
  RESULTS,
  distanceLabel,
  placeSubtitle,
  searchMoreLabel,
} from './copy';
import { PlaceRow } from './PlaceRow';
import { usePosition } from './usePosition';

export interface PlacePickerBodyProps {
  /** The picker is on screen: it asks for the device's position and runs its searches only then. */
  active: boolean;
  /** The place the Bev has now: checked in the list, and removable. */
  selected?: Venue | null;
  onSelect: (venue: Venue) => void;
  /** Shown as "Remove location" while `selected` is set. */
  onRemove?: () => void;
  /** The caller is saving the choice: rows take no press, and the chosen one dims. */
  saving?: boolean;
  /** The caller's save failed; shown above the list. */
  error?: unknown;
}

/**
 * The place picker's content (BEV-22): a search field over Bevi's own venues, nearest first.
 *
 * With nothing typed it lists the places you used last, then what is nearby, so the shop you are
 * standing in, or the one you are tagging a run of Bevs at, is one tap away. With a query it
 * matches names, and offers one more row, "Search more places", which asks an outside
 * directory for a place Bevi does not have and makes a venue of the one you pick. That second search
 * is never automatic: it costs money per call and is rate limited, so it runs on a tap.
 *
 * Without a position (denied, unavailable, or not provided on this platform) it works by name alone.
 */
export function PlacePickerBody({ active, selected = null, onSelect, onRemove, saving = false, error }: PlacePickerBodyProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const query = useDebouncedValue(text).trim();
  const position = usePosition(active);
  const near = position.kind === 'ok' ? position.position : null;
  // Hold the first search until the position is in or given up on, so "Nearby" does not flash a
  // by-name-only answer first.
  const settled = position.kind !== 'idle' && position.kind !== 'locating';
  const search = useVenueSearch(query, near, active && (settled || query.length > 0));

  // "Search more places" is armed for one query at a time.
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const more = useSearchMorePlaces(query, near, moreFor !== null && moreFor === query);
  const addPlace = useAddPlace();
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (active) return;
    setText('');
    setMoreFor(null);
    setAdding(null);
    addPlace.reset();
    // Deliberately on `active` only: closing the picker forgets the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The places used last lead the empty picker, and are not repeated under Nearby.
  const recent = useRecentVenues(active);
  const recents = query ? [] : (recent.data ?? []);
  const recentIds = new Set(recents.map((v) => v.id));
  const results = (search.data ?? []).filter((m) => !recentIds.has(m.venue.id));
  const waiting = active && (search.isLoading || (!query && !settled));
  const armed = moreFor === query && query.length > 0;

  const add = (place: ExternalPlace) => {
    setAdding(place.placeId);
    addPlace.mutate(place.placeId, {
      onSuccess: (venue) => onSelect(venue),
      onSettled: () => setAdding(null),
    });
  };

  const moreError = more.error ?? addPlace.error;
  const moreMessage = moreError
    ? isApiError(moreError) && moreError.code === 'rate_limited'
      ? MORE_LIMITED
      : MORE_FAILED
    : null;

  return (
    <View>
      <View style={styles.search}>
        <SearchBar
          variant="outlined"
          placeholder={PICKER_PLACEHOLDER}
          value={text}
          onChange={(v) => {
            setText(v);
            setMoreFor(null);
          }}
          autoFocus
        />
      </View>

      {error ? (
        <Text style={[type.body, styles.note, { color: colors.scoreLow }]} accessibilityRole="alert">
          {actionErrorMessage(error)}
        </Text>
      ) : null}

      {selected && onRemove ? <SheetOption label={REMOVE_LOCATION} icon="x" destructive onPress={saving ? undefined : onRemove} /> : null}

      {recents.length > 0 ? (
        <>
          <SheetSection title={RECENT} />
          {recents.map((venue) => (
            <PlaceRow
              key={venue.id}
              name={venue.name}
              subtitle={placeSubtitle(venue)}
              kind={venue.kind}
              selected={selected?.id === venue.id}
              busy={saving}
              onPress={() => onSelect(venue)}
            />
          ))}
        </>
      ) : null}

      {waiting ? (
        <View style={styles.loading} testID="place-picker-loading">
          <Skeleton width="60%" height={18} />
          <Skeleton width="80%" height={18} />
          <Skeleton width="50%" height={18} />
        </View>
      ) : null}

      {!waiting && results.length > 0 ? (
        <>
          <SheetSection title={query ? RESULTS : NEARBY} />
          {results.map(({ venue, distanceMeters }) => (
            <PlaceRow
              key={venue.id}
              name={venue.name}
              subtitle={placeSubtitle(venue, distanceMeters)}
              kind={venue.kind}
              selected={selected?.id === venue.id}
              busy={saving}
              onPress={() => onSelect(venue)}
            />
          ))}
        </>
      ) : null}

      {!waiting && results.length === 0 && recents.length === 0 ? (
        <Text style={[type.body, styles.note, { color: colors.textSecondary }]}>
          {query ? NO_MATCH : position.kind === 'denied' ? LOCATION_OFF : PICKER_HINT}
        </Text>
      ) : null}

      {!waiting && !query && results.length > 0 && position.kind === 'denied' ? (
        <Text style={[type.body, styles.note, { color: colors.textSecondary }]}>{LOCATION_OFF}</Text>
      ) : null}

      {query && !waiting && !armed ? (
        <SheetOption label={searchMoreLabel(query)} icon="globe" onPress={() => setMoreFor(query)} />
      ) : null}

      {armed ? (
        <>
          <SheetSection title={MORE_PLACES} />
          {more.isLoading ? (
            <View style={styles.loading} testID="place-picker-more-loading">
              <Skeleton width="70%" height={18} />
              <Skeleton width="55%" height={18} />
            </View>
          ) : null}
          {moreMessage ? (
            <Text style={[type.body, styles.note, { color: colors.scoreLow }]} accessibilityRole="alert">
              {moreMessage}
            </Text>
          ) : null}
          {(more.data ?? []).map((place) => (
            <PlaceRow
              key={place.placeId}
              name={place.name}
              subtitle={[place.address, distanceLabel(place.distanceMeters)].filter(Boolean).join(' · ')}
              busy={saving || adding !== null}
              onPress={() => add(place)}
            />
          ))}
          {more.isSuccess && more.data.length === 0 ? (
            <Text style={[type.body, styles.note, { color: colors.textSecondary }]}>{MORE_EMPTY}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export interface PlacePickerProps extends Omit<PlacePickerBodyProps, 'active'> {
  open: boolean;
  onClose: () => void;
}

/** The place picker as its own sheet (the ranking flow's note step). */
export function PlacePicker({ open, onClose, ...body }: PlacePickerProps) {
  return (
    <Sheet open={open} title={PICKER_TITLE} snap={90} onClose={onClose}>
      <PlacePickerBody active={open} {...body} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.md },
  note: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.md },
  loading: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.lg, gap: spacing.lg },
});

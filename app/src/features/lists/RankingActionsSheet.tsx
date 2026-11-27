import type { RankedBev } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRemoveRanking, useSetVenue, useUpdateNote } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { ADD_LOCATION, CHANGE_LOCATION, PICKER_TITLE, shortPlaceName } from '@/features/places/copy';
import { PlacePickerBody } from '@/features/places/PlacePicker';
import { actionErrorMessage } from '@/lib/errorCopy';
import { spacing, type, useTheme } from '@/theme';

import { SheetOption } from './SheetOption';

/** `rankings.updateNote` accepts up to 140 characters (contract `SubmitRankingInput.note`). */
export const NOTE_MAX = 140;
/** The Remove confirm: removing a ranking deletes its post, with that post's likes and comments. */
export const REMOVE_BODY = "It leaves your Bev'd list, with its post, likes and comments.";

type Mode = 'menu' | 'note' | 'place' | 'remove';

/**
 * A Bev'd row's actions (§6.5, §6.19): Bev it again (opens the ranking flow in re-rank mode), Edit note
 * (140 characters), Add or Change location (the place picker, in this sheet at its tall snap; BEV-22)
 * and Remove (with a short confirm that says the Bev's post, likes and comments go too).
 */
export function RankingActionsSheet({ ranked, onClose }: { ranked: RankedBev | null; onClose: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('menu');
  const [note, setNote] = useState('');
  const updateNote = useUpdateNote();
  const remove = useRemoveRanking();
  // The ranking flow opens once this sheet has finished closing, not in the same tick: a screen
  // pushed under a Modal that is still presented leaves iOS with a stuck or blank screen.
  const rankNext = useRef<string | null>(null);
  const setVenue = useSetVenue();

  const bevId = ranked?.bevId;
  useEffect(() => {
    // A new row resets the sheet (deliberately keyed on the Bev only).
    setMode('menu');
    setNote(ranked?.note ?? '');
    updateNote.reset();
    remove.reset();
    setVenue.reset();
  }, [bevId]);

  const name = ranked?.bev.name ?? '';

  const title = mode === 'note' ? 'Edit note' : mode === 'place' ? PICKER_TITLE : mode === 'remove' ? `Remove ${name}?` : name;

  return (
    <Sheet
      open={!!ranked}
      title={title}
      snap={mode === 'place' ? 90 : 40}
      onClose={onClose}
      onClosed={() => {
        const bevId = rankNext.current;
        rankNext.current = null;
        if (bevId) router.push({ pathname: '/rank/[bevId]', params: { bevId, mode: 'rerank' } });
      }}
    >
      {ranked && mode === 'menu' ? (
        <>
          <SheetOption
            label="Bev it again"
            icon="arrow-up-down"
            onPress={() => {
              rankNext.current = ranked.bevId;
              onClose();
            }}
          />
          <SheetOption label={ranked.note ? 'Edit note' : 'Add a note'} icon="file-text" onPress={() => setMode('note')} />
          <SheetOption
            label={ranked.venue ? CHANGE_LOCATION : ADD_LOCATION}
            icon="map-pin"
            detail={ranked.venue ? shortPlaceName(ranked.venue.name) : undefined}
            onPress={() => setMode('place')}
          />
          <SheetOption label="Remove from Bev'd" icon="x" destructive onPress={() => setMode('remove')} />
        </>
      ) : null}

      {ranked && mode === 'note' ? (
        <View style={styles.pad}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            placeholder="What stood out?"
            maxLength={NOTE_MAX}
            hint={`${note.length}/${NOTE_MAX}`}
            error={updateNote.error ? actionErrorMessage(updateNote.error) : undefined}
            autoFocus
          />
          <View style={styles.buttons}>
            <Button variant="outlined" onPress={() => setMode('menu')} style={styles.grow}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={updateNote.isPending}
              style={styles.grow}
              onPress={() =>
                updateNote.mutate({ bevId: ranked.bevId, note: note.trim() }, { onSuccess: onClose })
              }
            >
              Save note
            </Button>
          </View>
        </View>
      ) : null}

      {ranked && mode === 'place' ? (
        <PlacePickerBody
          active
          selected={ranked.venue}
          saving={setVenue.isPending}
          error={setVenue.error}
          onSelect={(venue) => setVenue.mutate({ bevId: ranked.bevId, venueId: venue.id }, { onSuccess: onClose })}
          onRemove={() => setVenue.mutate({ bevId: ranked.bevId, venueId: null }, { onSuccess: onClose })}
        />
      ) : null}

      {ranked && mode === 'remove' ? (
        <View style={styles.pad}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>
            {REMOVE_BODY}
          </Text>
          <Announce text={remove.error ? actionErrorMessage(remove.error) : null} />
          {remove.error ? (
            <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
              {actionErrorMessage(remove.error)}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Button variant="outlined" onPress={() => setMode('menu')} style={styles.grow}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={remove.isPending}
              style={styles.grow}
              accessibilityLabel={`Remove ${name}`}
              onPress={() => remove.mutate(ranked.bevId, { onSuccess: onClose })}
            >
              Remove
            </Button>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  buttons: { flexDirection: 'row', gap: spacing.md },
  grow: { flex: 1 },
});

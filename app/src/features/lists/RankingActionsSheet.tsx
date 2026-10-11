import type { RankedBev } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRemoveRanking, useUpdateNote } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { errorCopy } from '@/lib/errorCopy';
import { spacing, type, useTheme } from '@/theme';

import { BUCKET_SHORT } from './copy';
import { SheetOption } from './SheetOption';

/** `rankings.updateNote` accepts up to 140 characters (contract `SubmitRankingInput.note`). */
export const NOTE_MAX = 140;

type Mode = 'menu' | 'note' | 'remove';

/**
 * A Bev'd row's actions (§6.5, §6.19): Re-rank (opens the ranking flow in re-rank mode), Edit note
 * (140 characters) and Remove (with a confirm that explains the bucket's other scores shift).
 */
export function RankingActionsSheet({ ranked, onClose }: { ranked: RankedBev | null; onClose: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('menu');
  const [note, setNote] = useState('');
  const updateNote = useUpdateNote();
  const remove = useRemoveRanking();

  const bevId = ranked?.bevId;
  useEffect(() => {
    // A new row resets the sheet (deliberately keyed on the Bev only).
    setMode('menu');
    setNote(ranked?.note ?? '');
    updateNote.reset();
    remove.reset();
  }, [bevId]);

  const name = ranked?.bev.name ?? '';
  const failure = updateNote.error ?? remove.error;

  const title = mode === 'note' ? 'Edit note' : mode === 'remove' ? `Remove ${name}?` : name;

  return (
    <Sheet open={!!ranked} title={title} onClose={onClose}>
      {ranked && mode === 'menu' ? (
        <>
          <SheetOption
            label="Re-rank"
            icon="arrow-up-down"
            onPress={() => {
              onClose();
              router.push({ pathname: '/rank/[bevId]', params: { bevId: ranked.bevId, mode: 'rerank' } });
            }}
          />
          <SheetOption label={ranked.note ? 'Edit note' : 'Add a note'} icon="file-text" onPress={() => setMode('note')} />
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
            error={updateNote.error ? errorCopy(updateNote.error).message : undefined}
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

      {ranked && mode === 'remove' ? (
        <View style={styles.pad}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>
            {`It leaves your Bev'd list, and the other Bevs in ${BUCKET_SHORT[ranked.bucket]} shift to fill the gap.`}
          </Text>
          {remove.error ? (
            <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
              {errorCopy(failure).message}
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

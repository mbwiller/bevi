import type { Bucket } from '@bevi/shared';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { IconButton } from '@/components/IconButton';
import { TextField } from '@/components/TextField';
import { NOTE_MAX } from '@/state/rankingFlow';
import { size, spacing, type, useTheme } from '@/theme';

import { BUCKET_NAME } from './copy';
import { Notice } from './Notice';

export interface NoteStepProps {
  bucket: Bucket;
  /** Nothing to compare against: "First one in Loved". */
  firstInBucket: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onSkip: () => void;
  /** Take back the last comparison (absent when there were none). */
  onUndo?: () => void;
  onClose: () => void;
  saving: boolean;
  /** A failed save that Retry can fix (offline, rate limited): the placement is kept. */
  error?: unknown;
  /** Field message when the server rejected the note. */
  noteError?: string;
  notice?: string | null;
}

/** Ranking flow step 3: an optional 140-character note, then Save (or Skip). */
export function NoteStep({
  bucket,
  firstInBucket,
  note,
  onNoteChange,
  onSave,
  onSkip,
  onUndo,
  onClose,
  saving,
  error,
  noteError,
  notice,
}: NoteStepProps) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        {onUndo ? (
          <Button variant="ghost" size="md" icon="undo-2" onPress={onUndo}>
            Undo
          </Button>
        ) : (
          <View />
        )}
        <IconButton icon="x" label="Discard ranking" variant="filled" onPress={onClose} />
      </View>
      {notice ? <Notice>{notice}</Notice> : null}
      <View style={styles.body}>
        <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
          {firstInBucket ? `First one in ${BUCKET_NAME[bucket]}` : 'Add a note'}
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          {firstInBucket ? 'Nothing to compare yet. Add a note if you like.' : 'Optional. Your friends see it with your ranking.'}
        </Text>
        <TextField
          label="Note"
          placeholder="Tastes like flat Sprite"
          value={note}
          onChange={onNoteChange}
          maxLength={NOTE_MAX}
          hint={`${note.length}/${NOTE_MAX}`}
          error={noteError}
          enterKeyHint="done"
          onSubmit={saving ? undefined : onSave}
          autoFocus
        />
        {error ? <ErrorState error={error} onRetry={onSave} style={styles.error} /> : null}
        <Button variant="primary" block loading={saving} onPress={onSave}>
          Save
        </Button>
        <Button variant="ghost" block disabled={saving} onPress={onSkip}>
          Skip
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: size.header, paddingHorizontal: spacing.sm },
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.xl },
  error: { paddingVertical: spacing.md },
});

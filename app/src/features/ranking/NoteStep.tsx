import { BANDS } from '@bevi/ranking';
import type { Bucket } from '@bevi/shared';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn, useReducedMotion } from 'react-native-reanimated';

import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { IconButton } from '@/components/IconButton';
import { ScoreBubble } from '@/components/ScoreBubble';
import { TextField } from '@/components/TextField';
import { NOTE_MAX } from '@/state/rankingFlow';
import { motion, size, spacing, type, useTheme } from '@/theme';

import { BUCKET_NAME, placeLine } from './copy';
import { Notice } from './Notice';

export interface NoteStepProps {
  bucket: Bucket;
  /** The score this placement will be saved with (`storedScore` from @bevi/ranking), unrounded. */
  score: number;
  /** Where the Bev lands, 0 = best. */
  position: number;
  /** The bucket's size with this Bev in it; 1 is "First one in Loved". */
  bucketSize: number;
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

/**
 * Ranking flow step 3: the score revealed the moment placement finishes (ScoreBubble 72 over
 * "#4 of 31 in Loved", pouring in and counting up from the bucket's lower edge), then an optional
 * 140-character note, then Save (or Skip).
 */
export function NoteStep({
  bucket,
  score,
  position,
  bucketSize,
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
  const reduced = useReducedMotion();
  const firstInBucket = bucketSize === 1;
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
      <View style={styles.reveal}>
        <Animated.View testID="note-score" entering={reduced ? undefined : ZoomIn.duration(motion.pour)}>
          <ScoreBubble score={score} bucket={bucket} size={72} countFrom={BANDS[bucket][0]} />
        </Animated.View>
        <Text style={[type.screenTitle, styles.center, { color: colors.text }]} accessibilityRole="header">
          {firstInBucket ? `First one in ${BUCKET_NAME[bucket]}` : placeLine(position, bucketSize, bucket)}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={[type.body, styles.center, { color: colors.textSecondary }]}>
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
  reveal: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  center: { textAlign: 'center' },
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  error: { paddingVertical: spacing.md },
});

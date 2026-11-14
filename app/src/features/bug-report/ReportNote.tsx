import { isApiError, type BugReportEnvironment } from '@bevi/shared';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { HitTarget, PRESSED, TARGET_MIN } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { Skeleton } from '@/components/Skeleton';
import { errorCopy } from '@/lib/errorCopy';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { MAX_FONT_SCALE_DENSE, motion, radius, size, spacing, type, useTheme } from '@/theme';

import { contextRows } from './context';
import { safeRecordedSteps, safeTrailSnapshot } from './engine';
import { KIND_LABEL } from './labels';
import { currentLevel, marksOfVisit, photoSlots, pictureNotices, type Draft, type Mark, type ShotEntry } from './model';
import { pickPhotos } from './photos';
import { REPORT_UI, useLayer } from './ReportLayer';
import { kindOf } from './send';
import {
  addPhotos,
  cycleKind,
  discardNote,
  noteFocused,
  openReports,
  removeMark,
  removePhoto,
  removeShot,
  selectMark,
  setAside,
  setIncludeSteps,
  setPanelHeight,
  setText,
  stepLevel,
  useReport,
} from './store';

/** The server's own cap on the description. */
export const NOTE_MAX = 4000;
const LINE = type.bodyLarge.lineHeight;
const MAX_LINES = 5;
const THUMB_W = 56;
const THUMB_H = 84;
const RISE = 24;

/**
 * The note: a panel along the bottom of the column with one field and Send. No scrim and not
 * modal: the app above it stays usable, so the tester can scroll, tap and drag the drop onto
 * something else while it is open. It lifts with the keyboard and scrolls inside past 60% of the
 * window.
 */
export function ReportNote({ onSend }: { onSend: () => void }) {
  const draft = useReport((s) => s.draft);
  const open = useReport((s) => s.panel === 'open' && s.sheet === null);
  if (!draft || !open) return null;
  return <NotePanel draft={draft} onSend={onSend} />;
}

function NotePanel({ draft, onSend }: { draft: Draft; onSend: () => void }) {
  const { colors, elevation } = useTheme();
  const layer = useLayer();
  const insets = useSafeAreaInsets();
  const lift = useKeyboardInset();
  const reduced = useReducedMotion();
  const focusNote = useReport((s) => s.focusNote);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Rises in once when it opens (Reduce Motion: just shows).
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    shown.value = reduced ? 1 : withTiming(1, { duration: motion.base });
  }, [reduced, shown]);
  const rise = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * RISE }] }));

  // How much of the column the panel covers, so the drop rests above it: its height plus the keyboard under it.
  const measured = useRef(0);
  useEffect(() => setPanelHeight(measured.current + lift), [lift]);
  useEffect(() => () => setPanelHeight(0), []);

  return (
    <Animated.View
      {...REPORT_UI}
      accessibilityLabel="Report note"
      testID="report-note"
      onLayout={(e) => {
        measured.current = e.nativeEvent.layout.height;
        setPanelHeight(measured.current + lift);
      }}
      style={[
        styles.panel,
        {
          bottom: lift,
          maxHeight: Math.round(layer.height * 0.6),
          backgroundColor: colors.surface,
          borderColor: colors.border,
          boxShadow: elevation.floating,
          paddingBottom: insets.bottom + spacing.md,
        },
        rise,
      ]}
    >
      {confirmDiscard ? (
        <View style={styles.header} accessibilityLiveRegion="polite">
          <Text style={[type.body, styles.grow, { color: colors.text }]}>Discard this note?</Text>
          <Button variant="ghost" onPress={() => setConfirmDiscard(false)}>
            Keep
          </Button>
          <Button
            onPress={() => {
              setConfirmDiscard(false);
              discardNote();
            }}
          >
            Discard
          </Button>
        </View>
      ) : (
        <View style={styles.header}>
          <KindChip draft={draft} />
          <View style={styles.grow} />
          <IconButton icon="list" label="Your reports" size={24} onPress={openReports} />
          <IconButton icon="chevron-down" label="Set aside" size={24} onPress={setAside} />
          <IconButton icon="x" label="Discard" size={24} onPress={() => setConfirmDiscard(true)} />
        </View>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Failure error={draft.error} />
        <Pictures draft={draft} />
        <NoteField draft={draft} autoFocus={focusNote} />
        <Attached draft={draft} />
      </ScrollView>
      {/* Outside the scroller, so Send is on screen however much the note holds. */}
      <View style={styles.footer}>
        <Button variant="primary" block disabled={!draft.text.trim()} onPress={onSend}>
          {draft.error ? 'Try again' : 'Send'}
        </Button>
      </View>
    </Animated.View>
  );
}

/** One quiet chip: the kind the note will be filed as, inferred until pressed, then pinned. */
function KindChip({ draft }: { draft: Draft }) {
  const kind = useMemo(() => kindOf(draft, safeTrailSnapshot()), [draft]);
  const label = KIND_LABEL[kind];
  return (
    <Pill onPress={() => cycleKind(kind)} accessibilityLabel={`Type: ${label}. Press to change.`} active={!!draft.kindOverride}>
      {label}
    </Pill>
  );
}

/** The last send's failure, in the app's words, and the server's when it says something more specific. */
function Failure({ error }: { error: unknown }) {
  const { colors } = useTheme();
  if (!error) return null;
  const copy = errorCopy(error);
  const specific = isApiError(error) && error.code === 'validation' && error.message ? error.message : null;
  return (
    <View role="alert" accessibilityLiveRegion="assertive" style={styles.failure}>
      <Text style={[type.heading, { color: colors.scoreLow }]}>{`${copy.title}. Your note is kept.`}</Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>{specific ? `${specific}.` : copy.message}</Text>
    </View>
  );
}

function Pictures({ draft }: { draft: Draft }) {
  const { colors } = useTheme();
  const selectedId = useReport((s) => s.selectedMarkId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const notices = pictureNotices(draft);
  const slots = photoSlots(draft);
  const selected = draft.marks.find((m) => m.id === selectedId);
  const unshot = draft.marks.filter((m) => !draft.shots.some((s) => s.visit === m.visit));
  const big = draft.shots.find((s) => s.id === expanded && s.shot);

  const choose = async () => {
    setPhotoError(null);
    setPicking(true);
    try {
      const { photos, failed } = await pickPhotos(slots);
      const rejected = addPhotos(photos);
      if (failed) setPhotoError(failed === 1 ? "One image couldn't be read. Try another." : `${failed} images couldn't be read. Try others.`);
      else if (rejected.length) setPhotoError('3 pictures is the limit; the rest were left out.');
    } catch {
      setPhotoError("Those images couldn't be attached. Try others.");
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={styles.pictures}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
        {draft.shots.map((entry) => (
          <View key={entry.id} style={styles.group}>
            <ShotThumb
              entry={entry}
              hasMarks={marksOfVisit(draft, entry.visit).length > 0}
              expanded={expanded === entry.id}
              onToggle={() => setExpanded((id) => (id === entry.id ? null : entry.id))}
            />
            {marksOfVisit(draft, entry.visit).map((m) => (
              <MarkChip key={m.id} mark={m} selected={m.id === selectedId} />
            ))}
          </View>
        ))}
        {unshot.map((m) => (
          <MarkChip key={m.id} mark={m} selected={m.id === selectedId} />
        ))}
        {draft.photos.map((p, i) => (
          <View key={p.uri} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={[styles.thumb, { backgroundColor: colors.input }]} contentFit="cover" accessibilityLabel={`Photo ${i + 1}`} />
            <RemoveButton label={`Remove photo ${i + 1}`} onPress={() => removePhoto(p.uri)} />
          </View>
        ))}
        <Pressable
          onPress={() => void choose()}
          disabled={slots === 0 || picking}
          accessibilityRole="button"
          accessibilityLabel={slots === 0 ? 'Add photos, 3 pictures is the limit' : `Add photos, ${slots} left`}
          accessibilityState={{ disabled: slots === 0 || picking, busy: picking }}
          style={({ pressed }) => [
            styles.addTile,
            { borderColor: colors.borderStrong },
            slots === 0 && styles.disabled,
            pressed && PRESSED,
          ]}
        >
          <Icon name="image" size={20} strokeWidth={2} color={colors.primary} />
          <Text style={[type.caption, styles.center, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={2}>
            {picking ? 'Opening…' : 'Add photos'}
          </Text>
          <Text style={[type.caption, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {slots === 0 ? 'None left' : `${slots} left`}
          </Text>
        </Pressable>
      </ScrollView>

      {big?.shot ? (
        <Pressable onPress={() => setExpanded(null)} accessibilityRole="button" accessibilityLabel="Close the picture">
          <Image
            source={{ uri: big.shot.uri }}
            style={[styles.big, { aspectRatio: big.shot.width / Math.max(1, big.shot.height), backgroundColor: colors.input }]}
            contentFit="contain"
            accessibilityLabel={`Picture of ${big.route}`}
          />
        </Pressable>
      ) : null}

      {selected && selected.levels.length > 1 ? <LevelControls mark={selected} /> : null}

      {[...notices, ...(photoError ? [photoError] : [])].map((line) => (
        <Text key={line} style={[type.caption, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {line}
        </Text>
      ))}
    </View>
  );
}

function ShotThumb({ entry, hasMarks, expanded, onToggle }: { entry: ShotEntry; hasMarks: boolean; expanded: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const label = `Picture of ${entry.route}${hasMarks ? '' : ', whole screen'}`;
  return (
    <View style={styles.thumbWrap}>
      {entry.shot ? (
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={expanded ? `${label}. Press to close.` : `${label}. Press to open.`}>
          <Image source={{ uri: entry.shot.uri }} style={[styles.thumb, { backgroundColor: colors.input }]} contentFit="cover" />
        </Pressable>
      ) : null}
      {entry.pending ? (
        <View style={[styles.thumb, entry.shot ? styles.overlay : null]} accessibilityLabel="Taking the picture" aria-busy>
          <Skeleton variant="block" width={THUMB_W} height={THUMB_H} />
        </View>
      ) : null}
      {hasMarks || !entry.shot ? null : <RemoveButton label="Remove the picture" onPress={() => removeShot(entry.id)} />}
    </View>
  );
}

function MarkChip({ mark, selected }: { mark: Mark; selected: boolean }) {
  const { colors } = useTheme();
  const title = currentLevel(mark)?.title ?? 'Component';
  return (
    <View style={[styles.mark, { borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primaryTint : colors.surface }]}>
      <Pressable
        onPress={() => selectMark(mark.id)}
        accessibilityRole="button"
        accessibilityLabel={`Mark ${mark.n}, ${title}`}
        accessibilityState={{ selected }}
        style={styles.markLabel}
      >
        <HitTarget height={size.pill} />
        <Text
          style={[type.caption, styles.markText, { color: selected ? colors.primary : colors.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        >
          {`${mark.n} · ${title}`}
        </Text>
      </Pressable>
      <Pressable onPress={() => removeMark(mark.id)} accessibilityRole="button" accessibilityLabel={`Remove mark ${mark.n}`} style={styles.markRemove}>
        <HitTarget height={size.pill} width={24} />
        <Icon name="x" size={14} strokeWidth={2.25} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.remove, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <HitTarget height={REMOVE} width={REMOVE} borderWidth={1} />
      <Icon name="x" size={12} strokeWidth={2.5} color={colors.text} />
    </Pressable>
  );
}

/** Wider and Narrower: the component around the marked one, or the one inside it. */
function LevelControls({ mark }: { mark: Mark }) {
  const atInner = mark.levelIndex <= 0;
  const atOuter = mark.levelIndex >= mark.levels.length - 1;
  return (
    <View style={styles.levels}>
      <Pill onPress={() => stepLevel(mark.id, -1)} disabled={atInner} accessibilityLabel={`Narrower, mark ${mark.n}`}>
        Narrower
      </Pill>
      <Pill onPress={() => stepLevel(mark.id, 1)} disabled={atOuter} accessibilityLabel={`Wider, mark ${mark.n}`}>
        Wider
      </Pill>
    </View>
  );
}

function NoteField({ draft, autoFocus }: { draft: Draft; autoFocus: boolean }) {
  const { colors, elevation } = useTheme();
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(LINE * 2);
  const input = useRef<TextInput>(null);
  const placeholder = draft.marks.length > 0 ? 'What about it?' : "What's going on?";

  // Focused once, when the panel opens for a new note; reopening a set-aside note leaves the keyboard down.
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    noteFocused();
  }, [autoFocus]);

  return (
    <TextInput
      ref={input}
      value={draft.text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      accessibilityLabel={placeholder}
      multiline
      maxLength={NOTE_MAX}
      submitBehavior="newline"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
      style={[
        type.bodyLarge,
        styles.field,
        {
          height: Math.min(LINE * MAX_LINES, Math.max(LINE * 2, height)) + spacing.md * 2,
          color: colors.text,
          backgroundColor: colors.surface,
          borderColor: focused ? colors.primary : colors.borderStrong,
        },
        focused && { boxShadow: elevation.focusRing },
      ]}
    />
  );
}

/** What goes with the note, in one line; pressed, the whole list and the steps switch. */
function Attached({ draft }: { draft: Draft }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  // The trail is outside React; read again whenever the note changes, which is often enough for a summary.
  const steps = useMemo(() => safeRecordedSteps(safeTrailSnapshot()), [draft]);
  const rows = useMemo(() => contextRows(draft.environment), [draft.environment]);
  const summary = attachedSummary(draft, steps.length);
  return (
    <View style={[styles.attached, { borderColor: colors.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Sent with it: ${summary}`}
        aria-expanded={open}
        style={styles.attachedHead}
      >
        <Text style={[type.caption, styles.grow, { color: colors.textSecondary }]} numberOfLines={open ? undefined : 1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {summary}
        </Text>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} strokeWidth={2} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <View style={styles.attachedBody}>
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={[type.caption, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
                {row.label}
              </Text>
              <Text style={[type.caption, styles.rowValue, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
                {row.value}
              </Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={[type.body, styles.grow, { color: colors.text }]}>Include recorded steps</Text>
            <Switch
              value={draft.includeSteps}
              onValueChange={setIncludeSteps}
              accessibilityLabel="Include recorded steps"
              trackColor={{ true: colors.primary, false: colors.input }}
              thumbColor={colors.surface}
            />
          </View>
          {draft.includeSteps && steps.length ? (
            <View style={styles.steps}>
              {steps.map((step, i) => (
                <Text key={`${i}-${step}`} style={[type.caption, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
                  {`${i + 1}. ${step}`}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={[type.caption, { color: colors.textSecondary }]}>Only what you see here is sent. Nothing you typed elsewhere.</Text>
        </View>
      ) : null}
    </View>
  );
}

/** '1 picture · 6 recorded steps · iOS, home screen · build a1b2c3d'. */
export function attachedSummary(draft: Draft, stepCount: number): string {
  const pictures = draft.shots.length + draft.photos.length;
  const env: BugReportEnvironment = draft.environment;
  const device = [env.osVersion ?? env.platform, env.display].filter(Boolean).join(', ');
  const parts = [
    pictures ? `${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : null,
    draft.includeSteps && stepCount ? `${stepCount} recorded ${stepCount === 1 ? 'step' : 'steps'}` : null,
    device || null,
    env.build ? `build ${env.build}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'The screen and the build';
}

const REMOVE = 22;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: spacing.xs,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.gutter, minHeight: size.target },
  grow: { flex: 1, minWidth: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.xs },
  footer: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  failure: { gap: spacing.xs },
  pictures: { gap: spacing.sm },
  // Vertical padding keeps the 44pt expanders of the 30pt chips inside the horizontal scroller's clip.
  strip: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumbWrap: { width: THUMB_W, height: THUMB_H },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: radius.button, overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0, opacity: 0.6 },
  big: { width: '100%', maxHeight: 360, borderRadius: radius.input },
  mark: { flexDirection: 'row', alignItems: 'center', height: size.pill, borderWidth: 1, borderRadius: radius.pill, paddingLeft: spacing.md },
  markLabel: { height: size.pill, justifyContent: 'center', maxWidth: 180 },
  markText: { fontWeight: '600' },
  markRemove: { width: 28, height: size.pill, alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: -spacing.xs,
    right: -spacing.xs,
    width: REMOVE,
    height: REMOVE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    ...TARGET_MIN,
    width: THUMB_W + spacing.xl,
    height: THUMB_H,
    gap: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.button,
    paddingHorizontal: spacing.xs,
  },
  disabled: { opacity: 0.45 },
  center: { textAlign: 'center' },
  levels: { flexDirection: 'row', gap: spacing.sm },
  field: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: radius.input,
    textAlignVertical: 'top',
    outlineWidth: 0,
  },
  attached: { borderTopWidth: 1, paddingTop: spacing.xs },
  attachedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: size.target },
  attachedBody: { gap: spacing.sm, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  steps: { gap: 2 },
});

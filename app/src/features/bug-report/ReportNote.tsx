import { isApiError, type BugReportEnvironment, type BugReportKind } from '@bevi/shared';
import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { HitTarget, PRESSED, TARGET_MIN } from '@/components/HitTarget';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { Skeleton } from '@/components/Skeleton';
import { errorCopy } from '@/lib/errorCopy';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { MAX_FONT_SCALE_DENSE, motion, radius, size, spacing, type, useTheme } from '@/theme';

import { contextRows } from './context';
import { safeTrailSnapshot } from './engine';
import { KIND_LABEL } from './labels';
import {
  currentLevel,
  hasRoom,
  marksOfVisit,
  MARKS_MAX,
  photoSlots,
  pictureNotices,
  shotCaption,
  type Draft,
  type Mark,
  type ShotEntry,
} from './model';
import { pickPhotos } from './photos';
import { REPORT_UI, useLayer } from './ReportLayer';
import { kindOf } from './send';
import { REPORT_GLYPHS, type ReportGlyph } from './icons';
import {
  addPhotos,
  captureWholeScreen,
  discardNote,
  noteFocused,
  openReports,
  removeMark,
  removePhoto,
  removeShot,
  removeSteps,
  selectMark,
  setAside,
  setKind,
  setPanelHeight,
  setText,
  startRecording,
  startSelecting,
  stepLevel,
  useReport,
} from './store';

/** The server's own cap on the description. */
export const NOTE_MAX = 4000;
const LINE = type.bodyLarge.lineHeight;
const MIN_LINES = 2;
const MAX_LINES = 5;
const FIELD_PAD = spacing.md;
const THUMB_W = 56;
const THUMB_H = 84;
const RISE = 24;
const KINDS: readonly BugReportKind[] = ['bug', 'fix', 'idea', 'design'];

/**
 * The note: a panel along the bottom of the column. No scrim and not modal: the app above it stays
 * usable. Top to bottom: the type and the panel's own controls, the four ways to attach something
 * (select an element, capture the screen, record steps, add photos), what is attached, the text,
 * and Send, which stays on screen under a long note. It lifts with the keyboard and scrolls inside
 * past 60% of the window.
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
  const notice = useReport((s) => s.notice);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // One menu at a time: the type, or Add photos'.
  const [menu, setMenu] = useState<null | 'type' | 'photos'>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(size.target);
  const [panelH, setPanelH] = useState(0);
  // Where the actions row sits in the panel, so Add photos' menu can hang from its right-most tile.
  const [actionsAt, setActionsAt] = useState<{ wrap: number; top: number; height: number }>({ wrap: 0, top: 0, height: size.target });
  const typeTrigger = useRef<View>(null);
  const photosTrigger = useRef<View>(null);
  const photos = usePhotoPicker(draft);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Rises in once when it opens (Reduce Motion: just shows).
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    shown.value = reduced ? 1 : withTiming(1, { duration: motion.base });
  }, [reduced, shown]);
  const rise = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * RISE }] }));

  // How much of the column the panel covers, so the button rests above it: its height plus the keyboard under it.
  const measured = useRef(0);
  useEffect(() => setPanelHeight(measured.current + lift), [lift]);
  useEffect(() => () => setPanelHeight(0), []);

  const kind = useMemo(() => kindOf(draft, safeTrailSnapshot()), [draft]);

  return (
    <Animated.View
      {...REPORT_UI}
      accessibilityLabel="Report note"
      testID="report-note"
      onLayout={(e) => {
        measured.current = e.nativeEvent.layout.height;
        setPanelH(measured.current);
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
        <View style={styles.header} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <TypeTrigger ref={typeTrigger} kind={kind} open={menu === 'type'} onPress={() => setMenu((m) => (m === 'type' ? null : 'type'))} />
          <View style={styles.grow} />
          <IconButton icon="list" label="Filed reports" size={24} onPress={openReports} />
          <IconButton icon="chevron-down" label="Set aside" size={24} onPress={setAside} />
          <IconButton icon="x" label="Discard" size={24} onPress={() => setConfirmDiscard(true)} />
        </View>
      )}
      <View onLayout={(e) => setActionsAt((a) => ({ ...a, wrap: e.nativeEvent.layout.y }))}>
        <Actions
          draft={draft}
          photos={photos}
          photosOpen={menu === 'photos'}
          photosTrigger={photosTrigger}
          onPhotos={() => setMenu((m) => (m === 'photos' ? null : 'photos'))}
          onRowLayout={(top, height) => setActionsAt((a) => ({ ...a, top, height }))}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Failure error={draft.error} />
        {notice ? (
          <Text style={[type.caption, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        <Pictures draft={draft} />
        <Steps draft={draft} />
        <NoteField draft={draft} autoFocus={focusNote} />
        <Attached draft={draft} />
      </ScrollView>
      {/* Outside the scroller, so Send is on screen however much the note holds. */}
      <View style={styles.footer}>
        <Button variant="primary" block disabled={!draft.text.trim()} onPress={onSend}>
          {draft.error ? 'Try again' : 'Send'}
        </Button>
      </View>
      {/* At the panel's level, above the scroller, so the scroller can't clip it. */}
      {menu === 'type' && !confirmDiscard ? (
        <NoteMenu
          label="Type"
          position={{ top: headerHeight + spacing.xs, left: spacing.gutter }}
          trigger={typeTrigger}
          onClose={closeMenu}
          items={KINDS.map((k) => ({
            key: k,
            role: 'menuitemradio' as const,
            label: KIND_LABEL[k],
            checked: k === kind,
            onPress: () => setKind(k),
          }))}
        />
      ) : null}
      {menu === 'photos' ? (
        <NoteMenu
          label="Add photos"
          position={photosMenuPosition(actionsAt, panelH)}
          trigger={photosTrigger}
          onClose={closeMenu}
          items={[
            {
              key: 'screenshot',
              role: 'menuitem',
              icon: 'camera',
              label: 'Screenshot of this screen',
              disabled: !hasRoom(draft),
              a11y: hasRoom(draft) ? 'Screenshot of this screen' : 'Screenshot of this screen, 3 pictures is the limit',
              onPress: captureWholeScreen,
            },
            {
              key: 'library',
              role: 'menuitem',
              icon: 'image',
              label: 'Photo library or camera',
              disabled: photoSlots(draft) === 0,
              a11y: photoSlots(draft) > 0 ? 'Photo library or camera' : 'Photo library or camera, 3 pictures is the limit',
              onPress: () => void photos.choose(),
            },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

/** The type, in a small pill with a chevron: it opens the type menu. */
function TypeTrigger({ ref, kind, open, onPress }: { ref: RefObject<View | null>; kind: BugReportKind; open: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const label = KIND_LABEL[kind];
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Type: ${label}`}
      accessibilityState={{ expanded: open }}
      {...({ 'aria-haspopup': 'menu', 'aria-expanded': open } as object)}
      style={({ pressed }) => [styles.trigger, { borderColor: colors.borderStrong, backgroundColor: colors.surface }, pressed && PRESSED]}
    >
      <HitTarget height={size.pill} borderWidth={1} />
      <Text style={[type.body, styles.triggerText, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="chevron-down" size={16} strokeWidth={2} color={colors.textSecondary} />
    </Pressable>
  );
}

export interface MenuItem {
  key: string;
  role: 'menuitem' | 'menuitemradio';
  label: string;
  /** The accessible name, when it says more than the label (why a row is disabled). */
  a11y?: string;
  icon?: IconName;
  /** menuitemradio: the current choice, with a check. */
  checked?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** How tall a two-row menu is, to decide whether it fits below its trigger. */
const MENU_ROWS_PAD = spacing.xs * 2 + 2;

/**
 * A minimal menu anchored to a trigger in the note (the type, Add photos): rows of 44pt, drawn at
 * the panel's level so the scroller can't clip it. Choosing a row closes it, and so do a press
 * anywhere else and Escape.
 */
function NoteMenu({
  label,
  items,
  position,
  trigger,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  position: { top: number; left?: number; right?: number };
  trigger: RefObject<View | null>;
  onClose: () => void;
}) {
  const { colors, elevation } = useTheme();
  const menu = useRef<View>(null);

  // On the web, a press anywhere outside the menu (the app included) and Escape close it. A press
  // on the trigger is left to the trigger, which toggles it.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const el = menu.current as unknown as HTMLElement | null;
    const opener = trigger.current as unknown as HTMLElement | null;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (el?.contains(e.target) || opener?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, trigger]);

  return (
    <>
      {/* Outside presses within the panel (and the only outside there is off the web). */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the menu"
        focusable={false}
        testID="note-menu-outside"
      />
      <View
        ref={menu}
        role="menu"
        accessibilityLabel={label}
        style={[styles.menu, position, { backgroundColor: colors.surface, borderColor: colors.border, boxShadow: elevation.floating }]}
      >
        {items.map((item) => (
          <Pressable
            key={item.key}
            {...({ role: item.role } as object)}
            {...(item.role === 'menuitemradio' ? { 'aria-checked': !!item.checked } : null)}
            accessibilityState={item.role === 'menuitemradio' ? { checked: !!item.checked, disabled: !!item.disabled } : { disabled: !!item.disabled }}
            accessibilityLabel={item.a11y ?? item.label}
            disabled={item.disabled}
            onPress={() => {
              // Closed first, so nothing of it is about when the row's action runs.
              onClose();
              item.onPress();
            }}
            style={({ pressed }) => [styles.menuRow, item.disabled && styles.disabled, pressed && { backgroundColor: colors.input }]}
          >
            {item.icon ? <Icon name={item.icon} size={20} strokeWidth={2} color={colors.primary} /> : null}
            <Text style={[type.body, styles.grow, { color: item.checked ? colors.primary : colors.text }]} numberOfLines={1}>
              {item.label}
            </Text>
            {item.role === 'menuitemradio' ? (
              item.checked ? (
                <Icon name="check" size={18} strokeWidth={2} color={colors.primary} />
              ) : (
                <View style={styles.checkSpace} />
              )
            ) : null}
          </Pressable>
        ))}
      </View>
    </>
  );
}

/**
 * Add photos' menu hangs from the right-most tile: its right edge on the tile's, opening downwards,
 * or upwards when the panel has no room below the row.
 */
function photosMenuPosition(at: { wrap: number; top: number; height: number }, panelHeight: number): { top: number; right: number } {
  const height = size.target * 2 + MENU_ROWS_PAD;
  const rowTop = at.wrap + at.top;
  const below = rowTop + at.height + spacing.xs;
  const fits = panelHeight === 0 || below + height <= panelHeight;
  return { top: fits ? below : rowTop - height - spacing.xs, right: spacing.gutter };
}

/** Add photos' library picker (iOS's own sheet: library, camera, files), several at once. */
function usePhotoPicker(draft: Draft) {
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const slots = photoSlots(draft);
  const choose = async () => {
    setError(null);
    setPicking(true);
    try {
      const { photos, failed } = await pickPhotos(slots);
      const rejected = addPhotos(photos);
      if (failed) setError(failed === 1 ? "One image couldn't be read. Try another." : `${failed} images couldn't be read. Try others.`);
      else if (rejected.length) setError('3 pictures is the limit; the rest were left out.');
    } catch {
      setError("Those images couldn't be attached. Try others.");
    } finally {
      setPicking(false);
    }
  };
  return { choose, picking, error };
}

type PhotoPicker = ReturnType<typeof usePhotoPicker>;

/** The four ways to attach something to the note. */
function Actions({
  draft,
  photos,
  photosOpen,
  photosTrigger,
  onPhotos,
  onRowLayout,
}: {
  draft: Draft;
  photos: PhotoPicker;
  photosOpen: boolean;
  photosTrigger: RefObject<View | null>;
  onPhotos: () => void;
  onRowLayout: (top: number, height: number) => void;
}) {
  const { colors } = useTheme();
  const slots = photoSlots(draft);
  const atMarkLimit = draft.marks.length >= MARKS_MAX;
  const room = hasRoom(draft);

  return (
    <View style={styles.actionsWrap}>
      <View style={styles.actions} onLayout={(e) => onRowLayout(e.nativeEvent.layout.y, e.nativeEvent.layout.height)}>
        <Action
          glyph="select"
          icon="search"
          label="Select element"
          a11y={atMarkLimit ? 'Select element, 6 marks is the limit' : 'Select element'}
          disabled={atMarkLimit}
          onPress={startSelecting}
        />
        <Action
          icon="camera"
          label="Capture screen"
          a11y={room ? 'Capture screen' : 'Capture screen, 3 pictures is the limit'}
          disabled={!room}
          onPress={captureWholeScreen}
        />
        <Action glyph="record" icon="navigation" label="Record steps" a11y="Record steps" onPress={startRecording} />
        {/* Opens a menu, so it stays pressable at the limit: the menu says why its rows are off. */}
        <Action
          ref={photosTrigger}
          icon="image"
          label={photos.picking ? 'Opening…' : 'Add photos'}
          a11y={slots === 0 ? 'Add photos, 3 pictures is the limit' : `Add photos, ${slots} left`}
          disabled={photos.picking}
          busy={photos.picking}
          expanded={photosOpen}
          onPress={onPhotos}
        />
      </View>
      {photos.error ? (
        <Text style={[type.caption, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {photos.error}
        </Text>
      ) : null}
    </View>
  );
}

function Action({
  ref,
  icon,
  glyph,
  label,
  a11y,
  disabled = false,
  busy = false,
  expanded,
  onPress,
}: {
  ref?: RefObject<View | null>;
  /** Set when the action opens a menu: whether it is open. */
  expanded?: boolean;
  icon: IconName;
  /** One of the reporter's own glyphs, drawn instead of `icon` (icons.ts). */
  glyph?: ReportGlyph;
  label: string;
  a11y: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const Glyph = glyph ? REPORT_GLYPHS[glyph] : null;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={expanded === undefined ? { disabled, busy } : { disabled, busy, expanded }}
      {...(expanded === undefined ? null : ({ 'aria-haspopup': 'menu', 'aria-expanded': expanded } as object))}
      aria-disabled={disabled}
      style={({ pressed }) => [styles.action, { borderColor: colors.border }, disabled && styles.disabled, pressed && PRESSED]}
    >
      {Glyph ? <Glyph size={20} strokeWidth={2} color={colors.primary} /> : <Icon name={icon} size={20} strokeWidth={2} color={colors.primary} />}
      <Text style={[type.caption, styles.center, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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

/** The pictures and selections, then the selected one's details and Wider / Narrower. */
function Pictures({ draft }: { draft: Draft }) {
  const { colors } = useTheme();
  const selectedId = useReport((s) => s.selectedMarkId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const notices = pictureNotices(draft);
  const selected = draft.marks.find((m) => m.id === selectedId);
  const unshot = draft.marks.filter((m) => !draft.shots.some((s) => s.visit === m.visit));
  const big = draft.shots.find((s) => s.id === expanded && s.shot);
  const empty = draft.shots.length === 0 && draft.photos.length === 0 && draft.marks.length === 0;

  return (
    <View style={styles.pictures}>
      {empty ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
          {draft.shots.map((entry) => (
            <View key={entry.id} style={styles.group}>
              <ShotThumb
                entry={entry}
                caption={shotCaption(draft, entry)}
                expanded={expanded === entry.id}
                onToggle={() => setExpanded((id) => (id === entry.id ? null : entry.id))}
              />
              {entry.kind === 'marked'
                ? marksOfVisit(draft, entry.visit).map((m) => <MarkChip key={m.id} mark={m} selected={m.id === selectedId} />)
                : null}
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
        </ScrollView>
      )}

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

      {selected ? <MarkDetail mark={selected} /> : null}

      {notices.map((line) => (
        <Text key={line} style={[type.caption, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {line}
        </Text>
      ))}
    </View>
  );
}

/**
 * One captured picture. A screen picture has its own remove; a marked one goes with its marks.
 * `caption` is the ticket's ('/lists, whole screen (2)'); a marked picture is named by its route.
 */
function ShotThumb({ entry, caption, expanded, onToggle }: { entry: ShotEntry; caption: string; expanded: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const screen = entry.kind === 'screen';
  const label = screen ? `Picture of ${caption}` : `Picture of ${entry.route}`;
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
      {screen && entry.shot ? <RemoveButton label={`Remove the picture of ${caption}`} onPress={() => removeShot(entry.id)} /> : null}
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
        {/* The chip is 30pt; the expander makes the label's target 44pt tall. */}
        <HitTarget height={size.pill} borderWidth={1} />
        <Text
          style={[type.caption, styles.markText, { color: selected ? colors.primary : colors.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        >
          {`${mark.n} · ${title}`}
        </Text>
      </Pressable>
      <Pressable onPress={() => removeMark(mark.id)} accessibilityRole="button" accessibilityLabel={`Remove mark ${mark.n}`} style={styles.markRemove}>
        {/* 44pt wide already; the expander makes it 44pt tall. */}
        <HitTarget height={size.pill} borderWidth={1} />
        <Icon name="x" size={14} strokeWidth={2.25} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

/** A 44pt target at the thumbnail's corner, holding the small round remove mark. */
function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.removeTarget}>
      <View style={[styles.remove, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="x" size={12} strokeWidth={2.5} color={colors.text} />
      </View>
    </Pressable>
  );
}

/** What was selected, plainly: the component and its source file, then Wider / Narrower. */
function MarkDetail({ mark }: { mark: Mark }) {
  const { colors } = useTheme();
  const level = currentLevel(mark);
  if (!level) return null;
  const line = [level.target.component, level.target.file].filter(Boolean).join(' · ');
  const atInner = mark.levelIndex <= 0;
  const atOuter = mark.levelIndex >= mark.levels.length - 1;
  return (
    <View style={styles.detail} testID="report-mark-detail">
      <Text style={[type.caption, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {line}
      </Text>
      {mark.levels.length > 1 ? (
        <View style={styles.levels}>
          <Pill onPress={() => stepLevel(mark.id, -1)} disabled={atInner} accessibilityLabel={`Narrower, mark ${mark.n}`}>
            Narrower
          </Pill>
          <Pill onPress={() => stepLevel(mark.id, 1)} disabled={atOuter} accessibilityLabel={`Wider, mark ${mark.n}`}>
            Wider
          </Pill>
        </View>
      ) : null}
    </View>
  );
}

/** The steps the tester recorded, numbered, with Record again and Remove steps. Nothing when there are none. */
function Steps({ draft }: { draft: Draft }) {
  const { colors } = useTheme();
  if (draft.steps.length === 0) return null;
  return (
    <View style={styles.stepsBlock} testID="report-steps">
      <Text style={[type.caption, styles.stepsTitle, { color: colors.textSecondary }]}>Steps</Text>
      {draft.steps.map((step, i) => (
        <Text key={`${i}-${step}`} style={[type.caption, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {`${i + 1}. ${step}`}
        </Text>
      ))}
      <View style={styles.levels}>
        <Pill onPress={startRecording}>Record again</Pill>
        <Pill onPress={removeSteps}>Remove steps</Pill>
      </View>
    </View>
  );
}

function NoteField({ draft, autoFocus }: { draft: Draft; autoFocus: boolean }) {
  const { colors, elevation } = useTheme();
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(LINE * MIN_LINES);
  const input = useRef<TextInput>(null);
  const placeholder = draft.marks.length > 0 ? 'What about it?' : "What's going on?";

  // Focused once, when the panel opens for a new note; reopening a set-aside note leaves the keyboard down.
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    noteFocused();
  }, [autoFocus]);

  // On the web the field's own content-size events over-report (an empty field read about five
  // lines), so the height is measured off the textarea itself: shrunk to its two rows, then its
  // scroll height read. (The input is the DOM textarea there.) Native keeps onContentSizeChange.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = input.current as unknown as HTMLTextAreaElement | null;
    if (!el || typeof el.scrollHeight !== 'number' || !el.style) return;
    const previous = el.style.height;
    el.style.height = '0px';
    const content = el.scrollHeight - FIELD_PAD * 2;
    el.style.height = previous;
    if (content > 0) setHeight(content);
  }, [draft.text]);

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
      onContentSizeChange={Platform.OS === 'web' ? undefined : (e) => setHeight(e.nativeEvent.contentSize.height)}
      {...(Platform.OS === 'web' ? ({ rows: MIN_LINES } as object) : null)}
      style={[
        type.bodyLarge,
        styles.field,
        {
          height: Math.min(LINE * MAX_LINES, Math.max(LINE * MIN_LINES, height)) + FIELD_PAD * 2,
          color: colors.text,
          backgroundColor: colors.surface,
          borderColor: focused ? colors.primary : colors.borderStrong,
        },
        focused && { boxShadow: elevation.focusRing },
      ]}
    />
  );
}

/** What goes with the note, in one line; pressed, the whole list. */
function Attached({ draft }: { draft: Draft }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => contextRows(draft.environment), [draft.environment]);
  const summary = attachedSummary(draft);
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
          <Text style={[type.caption, { color: colors.textSecondary }]}>Only what you see here is sent. Nothing you typed elsewhere.</Text>
        </View>
      ) : null}
    </View>
  );
}

/** '1 picture · iOS, home screen · build a1b2c3d'. */
export function attachedSummary(draft: Draft): string {
  const pictures = draft.shots.length + draft.photos.length;
  const env: BugReportEnvironment = draft.environment;
  const device = [env.osVersion ?? env.platform, env.display].filter(Boolean).join(', ');
  const parts = [
    pictures ? `${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : null,
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
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: size.pill,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  triggerText: { fontWeight: '500' },
  menu: {
    position: 'absolute',
    left: spacing.gutter,
    minWidth: 200,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  menuRow: { minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  checkSpace: { width: 18 },
  actionsWrap: { gap: spacing.xs, paddingHorizontal: spacing.gutter, paddingTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    ...TARGET_MIN,
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.button,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  footer: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  failure: { gap: spacing.xs },
  pictures: { gap: spacing.sm },
  // Vertical padding keeps the 44pt expanders of the 30pt chips inside the horizontal scroller's clip.
  strip: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm, paddingRight: spacing.sm },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumbWrap: { width: THUMB_W, height: THUMB_H },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: radius.button, overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0, opacity: 0.6 },
  big: { width: '100%', maxHeight: 360, borderRadius: radius.input },
  mark: { flexDirection: 'row', alignItems: 'center', height: size.pill, borderWidth: 1, borderRadius: radius.pill, paddingLeft: spacing.md },
  markLabel: { height: size.pill, justifyContent: 'center', maxWidth: 180, paddingRight: spacing.xs },
  markText: { fontWeight: '600' },
  markRemove: { width: size.target, height: size.pill, alignItems: 'center', justifyContent: 'center' },
  // The target sits over the thumbnail's top-right corner; the visible mark is its top-right 22pt.
  removeTarget: {
    position: 'absolute',
    top: -spacing.xs,
    right: -spacing.xs,
    width: size.target,
    height: size.target,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  remove: {
    width: REMOVE,
    height: REMOVE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  center: { textAlign: 'center' },
  detail: { gap: spacing.sm },
  levels: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  stepsBlock: { gap: spacing.xs },
  stepsTitle: { fontWeight: '600' },
  field: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingVertical: FIELD_PAD,
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
});

import type { BugReportEnvironment, BugReportResult } from '@bevi/shared';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReportBug } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { pickImage, preparePhoto, revokeIfBlob, isUnsupportedImage, type PreparedPhoto } from '@/features/create-bev/photo';
import { errorCopy } from '@/lib/errorCopy';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { collectContext, contextRows } from './context';
import { clearDraft, loadDraft, newIdempotencyKey, parseSteps, saveDraft, webStorage, type StorageLike } from './draft';
import { TextArea } from './TextArea';

/** The same cap the server applies, so the field stops before the server has to truncate. */
const TITLE_MAX = 160;
const DESCRIPTION_MAX = 4000;
const STEPS_MAX = 2000;

export interface BugReportFormProps {
  /** The route the reporter came from, which becomes the ticket's Screen line. */
  fromRoute?: string;
  onClose: () => void;
  /** Injected in tests; the app uses `localStorage`. */
  storage?: StorageLike | null;
}

/**
 * The internal bug reporter (DEVELOPMENT spec section 5, PNG 03). A full-screen
 * modal so it can be opened from any screen without losing it: closing returns
 * to where the reporter was.
 *
 * Shape of a submission: title (required) and whatever else is quick to add,
 * plus safe automatic context the reporter can see before sending. The
 * screenshot is uploaded as part of the submit, never on pick — nothing leaves
 * the device until the reporter presses the button.
 */
export function BugReportForm({ fromRoute, onClose, storage }: BugReportFormProps) {
  const { colors } = useTheme();
  const report = useReportBug();
  const lift = useKeyboardInset();

  const store = useMemo(() => (storage === undefined ? webStorage() : storage), [storage]);
  const restored = useMemo(() => loadDraft(store), [store]);

  const [title, setTitle] = useState(restored?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? '');
  const [steps, setSteps] = useState(restored?.steps ?? '');
  const [stepsOpen, setStepsOpen] = useState(!!restored?.steps);
  const [contextOpen, setContextOpen] = useState(false);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [created, setCreated] = useState<BugReportResult | null>(null);
  const [copied, setCopied] = useState(false);

  // One key per draft, reused by every retry of it: a retry must never make a
  // second ticket. A restored draft keeps the key it was saved with.
  const idempotencyKey = useRef(restored?.idempotencyKey ?? newIdempotencyKey());

  // The context is captured when the form opens, not when it is sent: the
  // timestamp should be when the bug was seen.
  const environment: BugReportEnvironment = useMemo(
    () => collectContext({ pathname: fromRoute }),
    [fromRoute],
  );
  const rows = useMemo(() => contextRows(environment), [environment]);

  const photoRef = useRef<PreparedPhoto | null>(null);
  photoRef.current = photo;
  useEffect(() => () => revokeIfBlob(photoRef.current?.uri), []);

  // Keep the draft current as it is typed, so a crash or a closed tab does not
  // lose it. Cleared the moment the report is filed.
  useEffect(() => {
    if (created) return;
    saveDraft(store, { title, description, steps, idempotencyKey: idempotencyKey.current });
  }, [store, title, description, steps, created]);

  const choose = useCallback(async () => {
    setPicking(true);
    setPhotoError(null);
    try {
      const asset = await pickImage('library');
      if (!asset) return;
      const prepared = await preparePhoto(asset);
      setPhoto((previous) => {
        revokeIfBlob(previous?.uri);
        return prepared;
      });
    } catch (e) {
      setPhotoError(
        isUnsupportedImage(e) ? "That image couldn't be read. Try another." : "That image couldn't be attached. Try another.",
      );
    } finally {
      setPicking(false);
    }
  }, []);

  const removePhoto = useCallback(() => {
    setPhoto((previous) => {
      revokeIfBlob(previous?.uri);
      return null;
    });
    setPhotoError(null);
  }, []);

  const titleError = titleTouched && !title.trim() ? 'Say what went wrong.' : undefined;

  const submit = useCallback(() => {
    setTitleTouched(true);
    if (!title.trim() || report.isPending) return;
    report.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        reproductionSteps: parseSteps(steps),
        environment,
        evidence: photo ? { file: photo.blob, mimeType: photo.mimeType } : undefined,
        idempotencyKey: idempotencyKey.current,
      },
      {
        onSuccess: (result) => {
          clearDraft(store);
          revokeIfBlob(photoRef.current?.uri);
          setPhoto(null);
          setCreated(result);
        },
      },
    );
  }, [title, description, steps, environment, photo, report, store]);

  const copyTicketId = useCallback(() => {
    if (!created) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(created.ticketId).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [created]);

  if (created) {
    return (
      <Screen onClose={onClose} title="Report sent">
        <View style={styles.body}>
          <View style={[styles.result, { borderColor: colors.border, backgroundColor: colors.input }]}>
            <Icon name="circle-check" size={28} strokeWidth={2} color={colors.scoreHigh} />
            <Text style={[type.screenTitle, { color: colors.text }]} role="heading" aria-level={2} accessibilityLiveRegion="polite">
              {created.status === 'duplicate' ? `Already filed as ${created.ticketId}` : `Created ${created.ticketId}`}
            </Text>
            <Text style={[type.body, styles.centred, { color: colors.textSecondary }]}>
              {created.status === 'duplicate'
                ? 'This report had already gone through, so nothing was filed twice.'
                : "It's in Triage. Someone will pick it up from there."}
            </Text>
          </View>
          <Button block icon="share" onPress={() => void Linking.openURL(created.ticketUrl)}>
            Open the ticket
          </Button>
          <Button block icon={copied ? 'check' : 'file-text'} onPress={copyTicketId}>
            {copied ? 'Ticket ID copied' : 'Copy ticket ID'}
          </Button>
          <Button variant="primary" block onPress={onClose}>
            Done
          </Button>
        </View>
      </Screen>
    );
  }

  const failure = report.isError ? errorCopy(report.error) : null;

  return (
    <Screen onClose={onClose} title="Report an issue" draft={!!restored}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + lift }]}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          label="What went wrong?"
          value={title}
          onChange={setTitle}
          placeholder="Ratings disappear after a refresh"
          error={titleError}
          maxLength={TITLE_MAX}
          editable={!report.isPending}
          autoFocus
        />

        <TextArea
          label="Describe the problem"
          value={description}
          onChange={setDescription}
          placeholder="What you did, and what happened instead."
          maxLength={DESCRIPTION_MAX}
          editable={!report.isPending}
          rows={4}
        />

        {stepsOpen ? (
          <TextArea
            label="Steps to reproduce"
            value={steps}
            onChange={setSteps}
            placeholder={'One step per line.'}
            hint="Optional. One step per line."
            maxLength={STEPS_MAX}
            editable={!report.isPending}
            rows={3}
          />
        ) : (
          <Button icon="plus" onPress={() => setStepsOpen(true)}>
            Add steps to reproduce
          </Button>
        )}

        {/* Evidence. Nothing is uploaded here: the file is held in memory and
            sent with the report, so closing the form sends nothing at all. */}
        {photo ? (
          <View style={[styles.photo, { borderColor: colors.border }]}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} contentFit="cover" accessibilityLabel="Attached screenshot" />
            <View style={styles.photoActions}>
              <Text style={[type.body, { color: colors.textSecondary }]}>Sent with the report.</Text>
              <View style={styles.row}>
                <Button icon="camera" onPress={() => void choose()} loading={picking} accessibilityLabel="Replace the screenshot">
                  Replace
                </Button>
                <Button icon="x" onPress={removePhoto} accessibilityLabel="Remove the screenshot">
                  Remove
                </Button>
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => void choose()}
            disabled={picking || report.isPending}
            accessibilityRole="button"
            accessibilityLabel="Add a screenshot"
            aria-busy={picking}
            style={({ pressed }) => [
              styles.picker,
              { borderColor: colors.borderStrong, backgroundColor: colors.surface },
              pressed && { backgroundColor: colors.input },
            ]}
          >
            <Icon name="image" size={24} strokeWidth={2} color={colors.primary} />
            <Text style={[type.heading, { color: colors.text }]}>{picking ? 'Opening…' : 'Add a screenshot'}</Text>
            <Text style={[type.caption, { color: colors.textSecondary }]}>Optional. Nothing is sent until you submit.</Text>
          </Pressable>
        )}
        {photoError ? (
          <Text style={[type.caption, { color: colors.scoreLow }]} accessibilityLiveRegion="polite" role="alert">
            {photoError}
          </Text>
        ) : null}

        {/* What goes with the report, shown before it does. */}
        <View style={[styles.context, { borderColor: colors.border, backgroundColor: colors.input }]}>
          <Pressable
            onPress={() => setContextOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Automatically included"
            aria-expanded={contextOpen}
            style={styles.contextHead}
          >
            <Text style={[type.caption, styles.contextTitle, { color: colors.textSecondary }]}>Automatically included</Text>
            <Icon name={contextOpen ? 'chevron-down' : 'chevron-right'} size={18} strokeWidth={2} color={colors.textSecondary} />
          </Pressable>
          {contextOpen ? (
            <View style={styles.contextRows}>
              {rows.map((row) => (
                <View key={row.label} style={styles.contextRow}>
                  <Text style={[type.body, { color: colors.textSecondary }]}>{row.label}</Text>
                  <Text style={[type.body, styles.contextValue, { color: colors.text }]} numberOfLines={1}>
                    {row.value}
                  </Text>
                </View>
              ))}
              <Text style={[type.caption, { color: colors.textSecondary }]}>
                No account details, no page contents and nothing you typed elsewhere.
              </Text>
            </View>
          ) : null}
        </View>

        {failure ? (
          <View accessibilityLiveRegion="polite" role="alert" style={styles.failure}>
            <Text style={[type.heading, { color: colors.scoreLow }]}>{failure.title}</Text>
            <Text style={[type.body, { color: colors.textSecondary }]}>
              {`${failure.message} Your report is saved${photo ? '; add the screenshot again if you replaced it' : ''}.`}
            </Text>
          </View>
        ) : null}

        <Button variant="primary" block loading={report.isPending} onPress={submit}>
          {report.isError ? 'Try again' : 'Submit bug report'}
        </Button>
        <Text style={[type.caption, styles.centred, { color: colors.textSecondary }]}>
          Internal only. The screenshot is uploaded privately.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Screen({
  title,
  draft = false,
  onClose,
  children,
}: {
  title: string;
  draft?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={title} actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: onClose }]} />
      {draft ? (
        <Text style={[type.caption, styles.draftNote, { color: colors.textSecondary }]}>
          Your last draft was restored. Add the screenshot again if you had one.
        </Text>
      ) : null}
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: spacing.xl, padding: spacing.gutter },
  centred: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  draftNote: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  picker: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 132,
    padding: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.card,
  },
  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  thumb: { width: 72, height: 96, borderRadius: radius.photo },
  photoActions: { flex: 1, minWidth: 0, gap: spacing.sm },
  context: { borderWidth: 1, borderRadius: radius.card },
  contextHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.target,
    paddingHorizontal: spacing.lg,
  },
  contextTitle: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  contextRows: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  contextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  contextValue: { flexShrink: 1, textAlign: 'right' },
  result: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderWidth: 1, borderRadius: radius.card },
  failure: { gap: spacing.xs },
});

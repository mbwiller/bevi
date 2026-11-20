import { REPORT_NOTE_MAX, REPORT_REASONS, type Profile, type ReportContentKind, type ReportReason } from '@bevi/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useBlock, useReport } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { radius, size, spacing, type, useTheme } from '@/theme';

import {
  BLOCK_ACTION,
  BLOCK_TOO,
  MORE_ACTIONS,
  NOTE_COUNTDOWN,
  NOTE_PLACEHOLDER,
  REPORT_ACTION,
  REPORT_PROMPT,
  REPORT_REASON_LABELS,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  SEND_REPORT,
  GONE_BODY,
  GONE_TITLE,
  blockBody,
  blockFailure,
  blockTitle,
  reportFailure,
  type Failure,
} from './copy';

/** What the sheet acts on: a post, a comment or a profile, and the person behind it. */
export interface SafetyTarget {
  kind: ReportContentKind;
  /** `FeedItem.id` / `ExplorePost.id`, `Comment.id` or `Profile.id`, as `reports.report` takes it. */
  id: string;
  author: Pick<Profile, 'id' | 'handle' | 'displayName'>;
}

export interface SafetyFlowProps {
  /** What the person opened More on; null closes the sheet. */
  target: SafetyTarget | null;
  onClose: () => void;
  /** The account was blocked (the sheet has closed): a profile leaves itself, since it now reads as not found. */
  onBlocked?: (target: SafetyTarget) => void;
}

type Step = 'menu' | 'report' | 'sent' | 'block';

/** Characters as the server counts them (code points of the trimmed note). */
const noteLength = (note: string) => Array.from(note.trim()).length;

/**
 * The More menu's sheet for a post, a comment or a profile: Report, Block account, and the steps
 * behind them, all in one sheet so two modals never stack (a full-screen iOS modal would cover a
 * second one). Menu, then either the report form (a reason, an optional note, a confirmation that
 * offers Block too) or the block confirmation, which says what blocking does before it happens.
 *
 * Render it inside the screen that opens it, never in the root layout. Never open it on your own
 * content: the entry points hide More there (the server refuses it anyway).
 */
export function SafetyFlow({ target, onClose, onBlocked }: SafetyFlowProps) {
  // Keep the last target while the sheet animates closed, and start each opening from the menu.
  const [shown, setShown] = useState(target);
  const [run, setRun] = useState(0);
  if (target && target !== shown) {
    setShown(target);
    setRun((r) => r + 1);
  }
  const [step, setStep] = useState<Step>('menu');
  const [lastRun, setLastRun] = useState(run);
  if (run !== lastRun) {
    setLastRun(run);
    setStep('menu');
  }
  const open = !!target;
  const title =
    step === 'menu' ? MORE_ACTIONS : step === 'block' && shown ? blockTitle(shown.author.handle) : step === 'sent' ? 'Report sent' : shown ? REPORT_ACTION[shown.kind] : MORE_ACTIONS;
  return (
    <Sheet open={open} title={title} snap={step === 'menu' ? 40 : 90} onClose={onClose}>
      {shown ? <FlowBody key={run} target={shown} step={step} setStep={setStep} onClose={onClose} onBlocked={onBlocked} /> : null}
    </Sheet>
  );
}

interface BodyProps {
  target: SafetyTarget;
  step: Step;
  setStep: (s: Step) => void;
  onClose: () => void;
  onBlocked?: (target: SafetyTarget) => void;
}

function FlowBody({ target, step, setStep, onClose, onBlocked }: BodyProps) {
  const { colors } = useTheme();
  const handle = target.author.handle;
  if (step === 'menu') {
    return (
      <View style={[styles.group, { borderTopColor: colors.border }]}>
        <OptionRow label={REPORT_ACTION[target.kind]} onPress={() => setStep('report')} />
        <OptionRow label={BLOCK_ACTION} a11y={`Block @${handle}`} danger onPress={() => setStep('block')} />
      </View>
    );
  }
  if (step === 'block') return <BlockStep target={target} onBack={() => setStep('menu')} onClose={onClose} onBlocked={onBlocked} />;
  if (step === 'sent') {
    return (
      <View style={styles.pad}>
        <Text style={[type.heading, { color: colors.text }]}>{REPORT_SENT_TITLE}</Text>
        <Text style={[type.bodyLarge, { color: colors.textSecondary }]}>{REPORT_SENT_BODY}</Text>
        <Button variant="outlined" block accessibilityLabel={`${BLOCK_TOO}, @${handle}`} onPress={() => setStep('block')}>
          {BLOCK_TOO}
        </Button>
        <Button variant="primary" block onPress={onClose}>
          Done
        </Button>
      </View>
    );
  }
  return <ReportStep target={target} onSent={() => setStep('sent')} />;
}

function ReportStep({ target, onSent }: { target: SafetyTarget; onSent: () => void }) {
  const { colors, elevation } = useTheme();
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const keyboard = useKeyboardInset(true);
  const left = REPORT_NOTE_MAX - noteLength(note);
  const canSend = !!reason && left >= 0 && !report.isPending;

  if (failure?.kind === 'gone') {
    return (
      <View style={styles.pad}>
        <Text style={[type.heading, { color: colors.text }]}>{GONE_TITLE}</Text>
        <Text style={[type.bodyLarge, { color: colors.textSecondary }]}>{GONE_BODY}</Text>
      </View>
    );
  }

  const send = () => {
    if (!canSend || !reason) return;
    setFailure(null);
    report.mutate(
      { kind: target.kind, id: target.id, reason, note: note.trim() || undefined },
      { onSuccess: onSent, onError: (e) => setFailure(reportFailure(e)) },
    );
  };

  return (
    <View style={[styles.pad, keyboard > 0 && { paddingBottom: keyboard }]}>
      <Text style={[type.body, { color: colors.textSecondary }]}>{REPORT_PROMPT}</Text>
      <View style={[styles.group, styles.bleed, { borderTopColor: colors.border }]} role="radiogroup" accessibilityLabel={REPORT_PROMPT}>
        {REPORT_REASONS.map((r) => (
          <OptionRow
            key={r}
            label={REPORT_REASON_LABELS[r]}
            role="radio"
            checked={reason === r}
            onPress={() => {
              setReason(r);
              setFailure(null);
            }}
          />
        ))}
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={NOTE_PLACEHOLDER}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Note"
        multiline
        aria-invalid={left < 0 ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.bodyLarge,
          styles.note,
          { color: colors.text, backgroundColor: colors.surface, borderColor: left < 0 ? colors.scoreLow : focused ? colors.primary : colors.borderStrong },
          focused && { boxShadow: elevation.focusRing },
        ]}
      />
      {left <= NOTE_COUNTDOWN ? (
        <Text
          style={[type.caption, styles.count, { color: left < 0 ? colors.scoreLow : colors.textSecondary }]}
          accessibilityLabel={left < 0 ? `${-left} characters over` : `${left} characters left`}
          accessibilityLiveRegion="polite"
        >
          {left}
        </Text>
      ) : null}
      {failure ? (
        <Text style={[type.body, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
          {failure.message}
        </Text>
      ) : null}
      <Button variant="primary" block disabled={!canSend} loading={report.isPending} onPress={send}>
        {SEND_REPORT}
      </Button>
    </View>
  );
}

function BlockStep({ target, onBack, onClose, onBlocked }: { target: SafetyTarget; onBack: () => void; onClose: () => void; onBlocked?: (t: SafetyTarget) => void }) {
  const { colors } = useTheme();
  const block = useBlock();
  const [failure, setFailure] = useState<Failure | null>(null);
  const handle = target.author.handle;
  if (failure?.kind === 'gone') {
    return (
      <View style={styles.pad}>
        <Text style={[type.heading, { color: colors.text }]}>{GONE_TITLE}</Text>
        <Text style={[type.bodyLarge, { color: colors.textSecondary }]}>{failure.message}</Text>
        <Button variant="primary" block onPress={onClose}>
          Done
        </Button>
      </View>
    );
  }
  const confirm = () => {
    setFailure(null);
    block.mutate(target.author.id, {
      onSuccess: () => {
        onClose();
        onBlocked?.(target);
      },
      onError: (e) => setFailure(blockFailure(e)),
    });
  };
  return (
    <View style={styles.pad}>
      <Text style={[type.bodyLarge, { color: colors.text }]}>{blockBody(handle)}</Text>
      {failure ? (
        <Text style={[type.body, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
          {failure.message}
        </Text>
      ) : null}
      <Button variant="primary" block loading={block.isPending} accessibilityLabel={`Block @${handle}`} onPress={confirm}>
        Block
      </Button>
      <Button variant="outlined" block disabled={block.isPending} onPress={onBack}>
        Cancel
      </Button>
    </View>
  );
}

interface OptionRowProps {
  label: string;
  a11y?: string;
  role?: 'button' | 'radio';
  checked?: boolean;
  danger?: boolean;
  onPress: () => void;
}

/** A 44pt+ option row with a 1pt divider, as in every other sheet; a `primary` check on the chosen reason. */
function OptionRow({ label, a11y, role = 'button', checked, danger, onPress }: OptionRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={a11y ?? label}
      accessibilityState={role === 'radio' ? { checked: !!checked } : undefined}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.input }]}
    >
      <Text style={[type.bodyLarge, styles.label, { color: danger ? colors.scoreLow : colors.text }]}>{label}</Text>
      {checked ? <Icon name="check" size={20} strokeWidth={2.25} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  group: { borderTopWidth: 1 },
  // The rows run edge to edge inside the padded column.
  bleed: { marginHorizontal: -spacing.gutter },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: size.target,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  label: { flex: 1, minWidth: 0 },
  note: {
    minHeight: size.target * 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: radius.card,
    textAlignVertical: 'top',
    outlineWidth: 0,
  },
  count: { alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
});

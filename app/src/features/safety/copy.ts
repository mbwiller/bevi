import { isApiError, REPORT_NOTE_MAX, type ReportContentKind, type ReportReason } from '@bevi/shared';

import { actionErrorMessage } from '@/lib/errorCopy';

/** What each reason says in the report sheet (sentence case, in the order `REPORT_REASONS` offers them). */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or scam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  violence: 'Violence or threats',
  sexual: 'Sexual content',
  self_harm: 'Self-harm',
  illegal: 'Illegal activity',
  misinformation: 'False information',
  other: 'Something else',
};

export const REPORT_ACTION: Record<ReportContentKind, string> = {
  post: 'Report post',
  comment: 'Report comment',
  profile: 'Report profile',
};

export const MORE_ACTIONS = 'More actions';
export const BLOCK_ACTION = 'Block account';
export const REPORT_PROMPT = 'Why are you reporting this?';
export const NOTE_PLACEHOLDER = 'Add a note (optional)';
export const SEND_REPORT = 'Send report';
export const REPORT_SENT_TITLE = 'Thanks, we got your report';
export const REPORT_SENT_BODY = "We'll review it. Reporting doesn't hide anything, so if you'd rather not see this person, you can block them too.";
export const BLOCK_TOO = 'Block this account too';

/** The remaining count on the note shows from this many characters left. */
export const NOTE_COUNTDOWN = 50;

export const GONE_TITLE = 'No longer available';
export const GONE_BODY = "This isn't here anymore, so there's nothing to report.";
export const BLOCK_GONE_BODY = "This account isn't available anymore, so there's nothing to block.";

/** The plain statement of what blocking does, shown before it happens. */
export const blockBody = (handle: string) =>
  `@${handle} won't see your posts or profile, and you won't see theirs. If either of you follows the other, that follow is removed. They aren't told you blocked them. You can unblock them any time in Settings > Blocked accounts.`;

export const blockTitle = (handle: string) => `Block @${handle}?`;

export type FailureKind = 'gone' | 'retry';

export interface Failure {
  kind: FailureKind;
  message: string;
}

/** Why a report didn't go through, and whether the person can try again. */
export function reportFailure(error: unknown): Failure {
  const code = isApiError(error) ? error.code : 'unknown';
  const field = isApiError(error) ? (error.detail as { field?: string } | undefined)?.field : undefined;
  switch (code) {
    case 'not_found':
      return { kind: 'gone', message: GONE_BODY };
    case 'rate_limited':
      return { kind: 'retry', message: "You've sent a lot of reports in a short time. Wait a minute, then try again." };
    case 'unauthorized':
      return { kind: 'retry', message: 'You were signed out. Sign in again, then send your report.' };
    case 'validation':
      return {
        kind: 'retry',
        message:
          field === 'reason'
            ? 'Pick a reason, then try again.'
            : field === 'note'
              ? `A note can be up to ${REPORT_NOTE_MAX} characters.`
              : "You can't report your own content.",
      };
    default:
      return { kind: 'retry', message: `Couldn't send your report. ${actionErrorMessage(error)}` };
  }
}

/** Why a block didn't go through. */
export function blockFailure(error: unknown): Failure {
  const code = isApiError(error) ? error.code : 'unknown';
  switch (code) {
    case 'not_found':
      return { kind: 'gone', message: BLOCK_GONE_BODY };
    case 'rate_limited':
      return { kind: 'retry', message: "You've blocked a lot of accounts in a short time. Wait a minute, then try again." };
    case 'validation':
      return { kind: 'retry', message: "You can't block yourself." };
    default:
      return { kind: 'retry', message: `Couldn't block this account. ${actionErrorMessage(error)}` };
  }
}

export function unblockMessage(error: unknown): string {
  return `Couldn't unblock this account. ${actionErrorMessage(error)}`;
}

import { isApiError } from '@bevi/shared';

import { COMMENT_MAX } from '@/components/CommentsSheet';
import { errorCopy } from '@/lib/errorCopy';

/**
 * The caption under the composer when a comment didn't post or delete: "Couldn't post your comment.
 * Wait a minute, then try again." ErrorState's copy fits loads, so 'network' and 'validation' get
 * wording for a comment.
 */
export function commentErrorMessage(action: 'post' | 'delete', error: unknown): string {
  const lead = action === 'post' ? "Couldn't post your comment." : "Couldn't delete your comment.";
  const code = isApiError(error) ? error.code : 'unknown';
  const detail =
    code === 'network'
      ? 'Check your connection and try again.'
      : code === 'validation'
        ? `A comment can be up to ${COMMENT_MAX} characters.`
        : errorCopy(error).message;
  return `${lead} ${detail}`;
}

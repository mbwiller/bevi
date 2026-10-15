import { isApiError } from '@bevi/shared';

import { errorCopy } from '@/lib/errorCopy';

/**
 * What a post says under its actions when a like or unlike didn't go through and the heart went
 * back: "Couldn't like this post. Wait a minute, then try again." ErrorState's copy fits loads, so
 * 'network' and 'not_found' get wording for a tap that was undone.
 */
export function likeErrorMessage(error: unknown, like: boolean): string {
  const lead = `Couldn't ${like ? 'like' : 'unlike'} this post.`;
  const code = isApiError(error) ? error.code : 'unknown';
  const detail =
    code === 'network'
      ? 'Check your connection and try again.'
      : code === 'not_found'
        ? 'It may have been removed.'
        : errorCopy(error).message;
  return `${lead} ${detail}`;
}

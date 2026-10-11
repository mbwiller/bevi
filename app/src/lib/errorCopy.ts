import { isApiError, type ApiErrorCode } from '@bevi/shared';

import type { IconName } from '@/components/Icon';

/** What ErrorState shows for a failure: what happened, what to do, and whether Retry can help. */
export interface ErrorCopy {
  title: string;
  message: string;
  icon: IconName;
  /** false when retrying the same call can't succeed (signed out, gone, not allowed). */
  retry: boolean;
}

// Design-system voice: say what happened and what to do, no apologies, no codes.
const COPY: Record<ApiErrorCode, ErrorCopy> = {
  network: {
    title: "You're offline",
    message: "We'll show this again as soon as you're back online.",
    icon: 'wifi-off',
    retry: true,
  },
  unauthorized: {
    title: "You're signed out",
    message: 'Sign in again to pick up where you left off.',
    icon: 'lock',
    retry: false,
  },
  not_found: {
    title: "This isn't here anymore",
    message: 'It may have been removed. Go back and try another.',
    icon: 'search',
    retry: false,
  },
  validation: {
    title: "That didn't go through",
    message: 'Check the details and try again.',
    icon: 'triangle-alert',
    retry: true,
  },
  conflict: {
    title: 'Your list changed',
    message: 'Something changed while you were away. Retry to load the latest.',
    icon: 'refresh-cw',
    retry: true,
  },
  age_restricted: {
    title: 'Not available',
    message: "This isn't available on your account.",
    icon: 'lock',
    retry: false,
  },
  rate_limited: {
    title: 'Too many tries',
    message: 'Wait a minute, then try again.',
    icon: 'clock',
    retry: true,
  },
  unknown: {
    title: "Couldn't load this",
    message: 'Check your connection and try again.',
    icon: 'triangle-alert',
    retry: true,
  },
};

/** Maps any thrown value to ErrorState copy: `ApiError` by code, everything else as `unknown`. */
export function errorCopy(error: unknown): ErrorCopy {
  return isApiError(error) ? (COPY[error.code] ?? COPY.unknown) : COPY.unknown;
}

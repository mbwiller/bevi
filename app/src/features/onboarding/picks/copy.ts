import { MAX_CATEGORY_PICKS } from '@bevi/shared';

/** The go-tos step's copy (§6.2a), in the design system's voice. */
export const PICKS_COPY = {
  header: 'Your go-tos',
  title: 'What are your go-tos?',
  body: `Pick up to ${MAX_CATEGORY_PICKS} kinds of Bev, favorite first. We'll start you with a few of each.`,
  continue: 'Continue',
  loading: 'Loading your go-tos',
} as const;

/** The line over Continue: what to do next, by how many are picked. */
export function helperLine(count: number): string {
  const left = MAX_CATEGORY_PICKS - count;
  if (count === 0) return 'Tap your number 1 first.';
  if (left <= 0) return `That's your ${MAX_CATEGORY_PICKS}. Tap one to swap it out.`;
  return left === 1 ? 'Pick 1 more, or continue.' : `Pick up to ${left} more, or continue.`;
}

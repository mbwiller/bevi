import { MIN_N_USER } from '@bevi/ranking';

/** Starter ranking copy (§6.3), in the design system's voice. */
export const STARTER_COPY = {
  introTitle: "Rank a few Bevs you've had",
  introBody:
    "We'll show you 10 popular Bevs. Rank the ones you've tried and skip the rest. It's how Bevi learns your taste.",
  start: 'Start',
  question: 'Have you had this?',
  yes: "I've had it",
  no: "Haven't had it",
  done: 'Done',
  placed: 'Placed. Keep going.',
  next: 'Next',
  finish: 'Go to your feed',
  rankMore: 'Rank more',
  showMore: 'Show me more',
  again: 'Go through them again',
  outTitle: "That's all of these",
  outBodyMore: 'Want a few more to choose from?',
  outBodyAgain: "You've seen every starter Bev. Have another look at the ones you skipped.",
  emptyTitle: 'No Bevs to rank yet',
  emptyBody: "We're still stocking the shelves. Try again in a bit.",
  tryAgain: 'Try again',
  saveFailed: "That didn't save",
} as const;

/** "Rank at least 3 so we can learn your taste", then how many are left. */
export function thresholdLine(ranked: number): string {
  if (ranked === 0) return `Rank at least ${MIN_N_USER} so we can learn your taste`;
  const left = MIN_N_USER - ranked;
  return left > 0 ? `Rank ${left} more so we can learn your taste` : 'Enough to get started. Keep going or tap Done.';
}

/** "3 of 10". */
export function progressLine(index: number, total: number): string {
  return `${Math.min(index + 1, total)} of ${total}`;
}

export function summaryTitle(count: number): string {
  return `You ranked ${count} ${count === 1 ? 'Bev' : 'Bevs'}`;
}

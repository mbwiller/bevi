/**
 * What the Add Bev screen's results list shows for the bar's text. Pure, so the rules are tested
 * without rendering.
 *
 *   idle     the bar is empty (or blank): Recents and "Popular on Bevi"
 *   results  the bar has text: grouped Bevs and People
 *
 * A query starting with "@" is a handle, so it searches people only: its Bev query is empty.
 */
export type SearchMode = 'idle' | 'results';

export function searchMode(q: string): SearchMode {
  return q.trim().length === 0 ? 'idle' : 'results';
}

/** The text the Bev search runs on: none for an "@handle". */
export function bevQueryFor(query: string): string {
  return query.startsWith('@') ? '' : query;
}

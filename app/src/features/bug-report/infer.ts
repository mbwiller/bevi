import type { BugReportKind } from '@bevi/shared';

/**
 * What the note's one sentence implies, so the reporter is not asked for it. Pure functions on the
 * text; the reporter can always change the kind with one tap.
 */

/** One pattern for a list of words and phrases, each matched whole. */
const anyOf = (alternatives: readonly string[]): RegExp => new RegExp(`\\b(${alternatives.join('|')})\\b`);

/** Something stopped working. These win over everything else. */
const BROKEN = anyOf([
  'crash(es|ed|ing)?',
  'broken?',
  'breaks',
  'bug(gy)?',
  'errors?',
  'fail(s|ed|ing|ure)?',
  'freez(es?|ing)',
  'froze',
  'stuck',
  'hangs?',
  "can'?t",
  'cannot',
  'unable',
  'not able',
  'only able',
  "doesn'?t",
  'does not',
  "didn'?t",
  'did not',
  "won'?t",
  "isn'?t working",
  'not working',
  'no longer',
  'nothing happens',
  'disappear(s|ed|ing)?',
  'missing',
  'blank',
  'never (loads?|shows?|opens?|saves?)',
  // Something moving that should hold still: "the fields move around when typing".
  '(jump|flicker|shift|move|bounce|jitter)(s|ed|ing)? (around|about)',
]);

/** "Wrong" on its own: a bug, unless the note is about how a pointed-at component looks. */
const WRONG = anyOf(['wrong', 'incorrect', 'off by', 'not right']);

/** A suggestion for something new. */
const IDEA = anyOf([
  'what if',
  'could we',
  'can we',
  'how about',
  'add an?',
  '(it )?would be (nice|great|cool|good)',
  'would love',
  'i wish',
  'wish (we|it|i|there)',
  'maybe we',
  'feature request',
  'idea',
]);

/** It works, and should work differently. "Move" counts as an instruction, not as something that happened. */
const CHANGE = anyOf([
  "should(n'?t| not)?",
  'instead',
  'rather than',
  'renamed?',
  'reorder(ed)?',
  'swap(ped)?',
  'the other way',
  'replace',
  'remove',
  '(change|move|make) (it|this|the|that|them)',
  'needs? to',
  'ought to',
]);

/** How it looks. */
const LOOKS = anyOf([
  'colou?rs?',
  'spacing',
  'padding',
  'margins?',
  'gaps?',
  'sizes?',
  'sized',
  'fonts?',
  'typography',
  'bold',
  'align(s|ed|ment)?',
  'misaligned',
  'cent(er|re)d?',
  'off[- ]cent(er|re)',
  'heavy',
  'light(er)?',
  'thin',
  'thick',
  'big(ger)?',
  'small(er)?',
  'tiny',
  'huge',
  'large',
  'tall',
  'short',
  'wide',
  'narrow',
  'cramped',
  'tight',
  'crowded',
  'overlap(s|ped|ping)?',
  'cut off',
  'clipped',
  'truncated',
  'contrast',
  'faint',
  'ugly',
  'looks?',
  'border',
  'shadow',
  'corners?',
  'round(ed)?',
  'radius',
  'blurry',
  'pixelated',
  'squished',
  'stretched',
]);

const normalise = (note: string): string => note.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * The kind a note most likely is. A recent failure, or words like "crash", "broken", "can't",
 * "doesn't", "wrong", "error" → 'bug'; "should", "instead", "rename", "move", "reorder" → 'fix';
 * "what if", "could we", "add a", "it would be nice" → 'idea'; a pointed-at component with words
 * about looks ("colour", "spacing", "size", "font", "align", "heavy") → 'design'. With nothing to
 * go on: 'design' when a component was pointed at, else 'bug'.
 *
 * Where a note matches more than one, in this order: something broken, an idea, the looks of a
 * pointed-at component, "wrong", a change.
 */
export function inferKind(note: string, signals: { hasTarget: boolean; recentFailure: boolean }): BugReportKind {
  const text = normalise(typeof note === 'string' ? note : '');
  if (signals.recentFailure || BROKEN.test(text)) return 'bug';
  if (IDEA.test(text)) return 'idea';
  if (signals.hasTarget && LOOKS.test(text)) return 'design';
  if (WRONG.test(text)) return 'bug';
  if (CHANGE.test(text)) return 'fix';
  return signals.hasTarget ? 'design' : 'bug';
}

const MAX_TITLE = 160;

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const ABBREVIATION = /\b(e\.g|i\.e|vs|etc)$/i;

/** The first sentence of a note: up to the first line break, or a full stop, "!" or "?" that ends a sentence. */
function firstSentence(note: string): string {
  const line = (note.trim().split(/\r?\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  // A stop ends a sentence when white space follows it and it does not close "e.g." or "i.e.".
  let sentence = line;
  for (const stop of line.matchAll(/[.!?](?=\s)/g)) {
    if (ABBREVIATION.test(line.slice(0, stop.index))) continue;
    sentence = line.slice(0, stop.index + 1);
    break;
  }
  const bare = sentence.replace(/[.\s]+$/, '');
  return bare || sentence.trim() || line;
}

/** Letters and digits only, so 'TabBar' is found in "the tab bar" and 'Add Bev' in "add-bev". */
const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Whether the sentence already says what was pointed at: any part of 'TabBar › Add Bev' or 'BevRow · Coca-Cola'. */
function names(sentence: string, pointedAt: string): boolean {
  const said = squash(sentence);
  return pointedAt
    .split(/\s[›·]\s/)
    .map(squash)
    .some((part) => part.length >= 3 && said.includes(part));
}

/**
 * The ticket title: the note's first sentence, prefixed with what was pointed at when the sentence
 * does not already name it ('TabBar › Add Bev: too heavy, make it flat'). One line, at most 160
 * characters, never empty for a non-empty note.
 */
export function titleFor(note: string, pointedAt?: string): string {
  const sentence = firstSentence(typeof note === 'string' ? note : '');
  const pointed = (pointedAt ?? '').replace(/\s+/g, ' ').trim();
  if (!sentence) return cut(pointed, MAX_TITLE);
  if (!pointed || names(sentence, pointed)) return cut(sentence, MAX_TITLE);
  const head = `${cut(pointed, 80)}: `;
  return `${head}${cut(sentence, MAX_TITLE - head.length)}`;
}

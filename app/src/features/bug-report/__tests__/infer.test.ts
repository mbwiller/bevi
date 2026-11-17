import type { BugReportKind } from '@bevi/shared';

import { inferKind, titleFor } from '../infer';

const NOTHING = { hasTarget: false, recentFailure: false };
const POINTED = { hasTarget: true, recentFailure: false };

describe('inferKind', () => {
  // Six real tickets, with the kind the person who filed each one gave it.
  it.each<[string, typeof NOTHING, BugReportKind]>([
    ['When adding a screenshot in the bug reporting feature, you are only able to attach one screenshot', NOTHING, 'bug'],
    ['When inputting a Bev, the description fields move around when typing', NOTHING, 'bug'],
    [
      'The buttons are currently Loved it, It was okay, Not for me from left to right. Intuitively, it should be the other way around',
      NOTHING,
      'fix',
    ],
    ["they shouldn't concatenate to one card, it should remain two cards", NOTHING, 'fix'],
    ["I don't like how this filter is called bucket, not super intuitive", POINTED, 'design'],
    ['the pill overlaps the bottom-left of the Bev photo in the first feed card', POINTED, 'design'],
  ])('real ticket: %s', (note, signals, kind) => {
    expect(inferKind(note, signals)).toBe(kind);
  });

  it.each<[string, typeof NOTHING, BugReportKind]>([
    // Something broken.
    ['The app crashes when I open a Bev', NOTHING, 'bug'],
    ['Search is broken', POINTED, 'bug'],
    ["I can't save my ranking", NOTHING, 'bug'],
    ['I can’t save my ranking', NOTHING, 'bug'],
    ["The like button doesn't do anything", POINTED, 'bug'],
    ['Got an error after submitting', NOTHING, 'bug'],
    ['The score is wrong', NOTHING, 'bug'],
    ['The list jumps around while it loads', NOTHING, 'bug'],
    // A change to something that works.
    ['This should say Want to Try', NOTHING, 'fix'],
    ['Show the score first instead', NOTHING, 'fix'],
    ['Rename this tab to Friends', POINTED, 'fix'],
    ['Move this below the photo', POINTED, 'fix'],
    ['Reorder the tabs', NOTHING, 'fix'],
    // Something new.
    ['What if we showed friends who also ranked it', NOTHING, 'idea'],
    ['Could we get a dark mode toggle', NOTHING, 'idea'],
    ['Add a share button here', POINTED, 'idea'],
    ['It would be nice to sort by price', NOTHING, 'idea'],
    // How a pointed-at component looks.
    ['too heavy, make it flat', POINTED, 'design'],
    ['The colour is too faint', POINTED, 'design'],
    ['spacing feels off here', POINTED, 'design'],
    ['wrong font size', POINTED, 'design'],
    ['Not aligned with the title', POINTED, 'design'],
    // The same words without a component are not a design note.
    ['wrong font size', NOTHING, 'bug'],
    // Nothing to go on.
    ['hmm', POINTED, 'design'],
    ['hmm', NOTHING, 'bug'],
    ['', NOTHING, 'bug'],
  ])('%s', (note, signals, kind) => {
    expect(inferKind(note, signals)).toBe(kind);
  });

  it('is a bug whenever something just failed, whatever the note says', () => {
    expect(inferKind('make this bigger', { hasTarget: true, recentFailure: true })).toBe('bug');
    expect(inferKind('what if this was faster', { hasTarget: false, recentFailure: true })).toBe('bug');
  });

  it('puts a broken thing before a suggestion in the same note', () => {
    expect(inferKind("The button doesn't work, it should open the sheet", NOTHING)).toBe('bug');
    expect(inferKind("I can't add a photo", NOTHING)).toBe('bug');
  });
});

describe('titleFor', () => {
  it('prefixes what was pointed at when the sentence does not name it', () => {
    expect(titleFor('too heavy, make it flat', 'TabBar › Add Bev')).toBe('TabBar › Add Bev: too heavy, make it flat');
    expect(titleFor('The score looks wrong.', 'BevRow · Coca-Cola')).toBe('BevRow · Coca-Cola: The score looks wrong');
  });

  it('leaves the prefix off when the sentence already names it', () => {
    expect(titleFor('The Add Bev button is too heavy', 'TabBar › Add Bev')).toBe('The Add Bev button is too heavy');
    expect(titleFor('the tab bar is too tall', 'TabBar › Add Bev')).toBe('the tab bar is too tall');
    expect(titleFor('Coca-Cola shows the wrong score', 'BevRow · Coca-Cola')).toBe('Coca-Cola shows the wrong score');
    expect(titleFor('The header is cut off', 'Header')).toBe('The header is cut off');
  });

  it('takes the first sentence only, on one line', () => {
    expect(titleFor('The buttons are the wrong way round. Intuitively, it should be the other way.')).toBe('The buttons are the wrong way round');
    expect(titleFor('First line\nsecond line')).toBe('First line');
    expect(titleFor('  Is   this\tright? I think not.  ')).toBe('Is this right?');
    expect(titleFor('It crashed! Twice.')).toBe('It crashed!');
  });

  it('does not stop at a decimal or an abbreviation', () => {
    expect(titleFor('The score shows 8.25 instead of 8.3. Odd.')).toBe('The score shows 8.25 instead of 8.3');
    expect(titleFor('Some rows, e.g. the first, are cut off. Others are fine.')).toBe('Some rows, e.g. the first, are cut off');
  });

  it('never exceeds 160 characters, and keeps what was pointed at when it cuts', () => {
    const long = 'word '.repeat(80).trim();
    expect(titleFor(long).length).toBeLessThanOrEqual(160);
    const pointed = titleFor(long, 'TabBar › Add Bev');
    expect(pointed.length).toBeLessThanOrEqual(160);
    expect(pointed.startsWith('TabBar › Add Bev: word word')).toBe(true);
    expect(pointed.endsWith('…')).toBe(true);
    expect(titleFor(long, 'x'.repeat(300)).length).toBeLessThanOrEqual(160);
  });

  it('is never empty for a non-empty note', () => {
    expect(titleFor('...')).toBe('...');
    expect(titleFor('?')).toBe('?');
    expect(titleFor('.', 'Header')).toBe('Header: .');
    expect(titleFor('x')).toBe('x');
  });

  it('falls back to what was pointed at for an empty note', () => {
    expect(titleFor('', 'TabBar › Add Bev')).toBe('TabBar › Add Bev');
    expect(titleFor('   ')).toBe('');
  });
});

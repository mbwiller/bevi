import { spacing, type } from '@/theme';

import { extrasRoom, FIELD_MIN_HEIGHT, fieldHeight, fieldMinHeight, isTight, noteRoom } from '../noteLayout';
import { toastBottom } from '../ReportToast';

const LINE = type.bodyLarge.lineHeight;

describe('the note’s room (T-21)', () => {
  it('with no keyboard, the note may cover 60% of the screen', () => {
    expect(noteRoom(812, 0, 0)).toBe(487);
    expect(noteRoom(1334, 0, 47)).toBe(800);
  });

  it('on a short screen 60% is too little, so it may take 480pt, and never more than the screen', () => {
    expect(noteRoom(667, 0, 20)).toBe(480);
    expect(noteRoom(375, 0, 0)).toBe(375 - spacing.sm);
  });

  it('with the keyboard up, it may fill everything the keyboard left, not 60% of it', () => {
    // An iPhone from the home screen: 812pt of page, 336pt of keyboard, so 476pt to see.
    const room = noteRoom(476, 336, 0);
    expect(room).toBe(476 - spacing.sm);
    // What squeezed the field to a line: 60% of the 476.
    expect(room).toBeGreaterThan(Math.round(476 * 0.6) + 150);
  });

  it('with the keyboard up, it stops below the status bar', () => {
    expect(noteRoom(476, 336, 47)).toBe(476 - 47);
  });

  it('is never negative', () => {
    expect(noteRoom(20, 336, 47)).toBe(0);
  });

  it('pictures and steps get a smaller share while typing, and never the whole note', () => {
    const typing = extrasRoom(468, 336);
    const resting = extrasRoom(487, 0);
    expect(typing).toBeLessThan(resting);
    // A row of thumbnails (84pt and its padding) fits without scrolling.
    expect(typing).toBeGreaterThanOrEqual(84 + spacing.sm * 2);
    // The field's three lines still fit beside it in a typing-sized note.
    expect(468 - typing).toBeGreaterThan(FIELD_MIN_HEIGHT + 180);
  });
});

describe('the field’s height (T-21)', () => {
  it('is three lines when empty', () => {
    expect(fieldHeight(0, 468)).toBe(FIELD_MIN_HEIGHT);
    expect(FIELD_MIN_HEIGHT).toBe(LINE * 3 + (spacing.md + 1) * 2);
  });

  it('follows the text past five lines, with no cap of its own', () => {
    expect(fieldHeight(LINE * 5, 468)).toBe(LINE * 5 + (spacing.md + 1) * 2);
    expect(fieldHeight(LINE * 40, 468)).toBe(LINE * 40 + (spacing.md + 1) * 2);
  });

  it('in a note too short for three lines and Send (a phone on its side), it may go down to one line', () => {
    expect(isTight(192)).toBe(true);
    expect(isTight(468)).toBe(false);
    expect(fieldMinHeight(192)).toBe(LINE + (spacing.md + 1) * 2);
    expect(fieldMinHeight(468)).toBe(FIELD_MIN_HEIGHT);
    expect(fieldHeight(0, 192)).toBe(LINE + (spacing.md + 1) * 2);
    // Its text still sets its height there.
    expect(fieldHeight(LINE * 4, 192)).toBe(LINE * 4 + (spacing.md + 1) * 2);
  });
});

describe('the filed toast over a tall note (T-21)', () => {
  it('stays where it was asked to be while that is on screen', () => {
    expect(toastBottom(400, 812, 0)).toBe(400);
  });

  it('never goes above the top of the screen when the note under it fills the room over the keyboard', () => {
    // The note: 468pt over a 336pt keyboard, so the toast was asked to sit 864pt up an 812pt screen.
    const bottom = toastBottom(468 + 336 + 8 + 44 + 8, 812, 47);
    expect(bottom).toBeLessThanOrEqual(812 - 47 - 44);
    expect(bottom).toBeGreaterThan(0);
  });
});

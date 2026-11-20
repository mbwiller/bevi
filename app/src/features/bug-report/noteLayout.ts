import { spacing, type } from '@/theme';

/**
 * The note's sizing, as plain functions so they are tested without a screen (T-21).
 *
 * The rule: the text field is what the note is for, so it gets the room. The note may grow to the
 * whole space above the keyboard while one is up, and to 60% of the screen otherwise (the app above
 * it stays usable; 480pt on a screen too short for 60% to be enough). Inside it the field grows with its text and gives way last: it never goes
 * below three lines, and once the note is as tall as it may be the field scrolls inside itself.
 */

/** One line of the note's text. */
export const NOTE_LINE = type.bodyLarge.lineHeight;
/** The field shows at least this many lines, empty or squeezed. */
export const FIELD_MIN_LINES = 3;
export const FIELD_PAD = spacing.md;
export const FIELD_BORDER = 1;

/** How much of the screen the note may cover while no keyboard is up. */
const RESTING_SHARE = 0.6;
/**
 * On a short screen 60% is too little for a picture, the field and Send together (400pt of an
 * iPhone SE's 667), so the note may take this much where the screen has it.
 */
const RESTING_FLOOR = 480;
/** How much of the note what goes with the text (pictures, steps) may take: less while typing. */
const EXTRAS_SHARE = { typing: 0.3, resting: 0.45 };

/**
 * The tallest the note may be. `visible` is the height the tester can see: the screen, less the
 * keyboard when one is up. With a keyboard the note may fill all of it below the status bar;
 * the old cap of 60% of what the keyboard left is what squeezed the field to a line.
 */
export function noteRoom(visible: number, keyboard: number, topInset: number): number {
  const all = Math.max(0, Math.round(visible - Math.max(topInset, spacing.sm)));
  if (keyboard > 0) return all;
  return Math.min(all, Math.max(Math.round(visible * RESTING_SHARE), RESTING_FLOOR));
}

/** The tallest the pictures and steps above the field may be before they scroll, so they never crowd it out. */
export function extrasRoom(room: number, keyboard: number): number {
  return Math.round(room * (keyboard > 0 ? EXTRAS_SHARE.typing : EXTRAS_SHARE.resting));
}

const FIELD_CHROME = (FIELD_PAD + FIELD_BORDER) * 2;

/** The field's least height: three lines and its own padding and border. */
export const FIELD_MIN_HEIGHT = NOTE_LINE * FIELD_MIN_LINES + FIELD_CHROME;

/**
 * Under this much room the note can't hold its controls, three lines and Send at once (a phone on
 * its side with the keyboard up). It then keeps one line, and the attach row goes while typing, so
 * Send stays on screen.
 */
export const TIGHT_ROOM = 300;

export function isTight(room: number): boolean {
  return room < TIGHT_ROOM;
}

/** The least the field may be squeezed to in a note that may be `room` tall. */
export function fieldMinHeight(room: number): number {
  return isTight(room) ? NOTE_LINE + FIELD_CHROME : FIELD_MIN_HEIGHT;
}

/**
 * The field's height for text `content` px tall in a note that may be `room` tall: all of the
 * text, however long. The note's own cap is what stops it.
 */
export function fieldHeight(content: number, room: number): number {
  return Math.max(fieldMinHeight(room), Math.ceil(content) + FIELD_CHROME);
}

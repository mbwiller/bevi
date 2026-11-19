/**
 * One line of text Vision read out of an image.
 *
 * Structurally the same as `RecognisedLine` in
 * `app/src/features/create-bev/nutritionPanel.ts`, which is what consumes it. It is declared
 * here as well so the module stands on its own, without importing out of `app/src`.
 */
export type RecognisedTextLine = {
  text: string;
  /** Vision's confidence in the top candidate, 0-1. */
  confidence: number;
  /** The line's bounding-box origin, normalised, origin bottom-left, exactly as Vision reports it. */
  x: number;
  y: number;
};

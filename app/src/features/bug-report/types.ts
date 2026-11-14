import type { BugReportTarget } from '@bevi/shared';

/**
 * The shapes the reporter's engine (pick, capture, trail, infer) and its UI (the button, the note,
 * the reports sheet) pass to each other. The engine never renders; the UI never touches the DOM
 * or React's internals directly.
 */

/** A rectangle in the viewport, in CSS px. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One component under a point. `pickAt` returns a list of these, innermost first, each one a
 * component written in `app/src` (never a React Native primitive), so stepping through the list is
 * "narrower" and "wider".
 */
export interface PickLevel {
  /** What the ticket will say about it. `evidenceIndex` and `mark` are the UI's to add. */
  target: BugReportTarget;
  /** Where it is on screen now. */
  box: Box;
  /** A short name for the highlight's label and the note: 'TabBar › Add Bev', 'BevRow · Coca-Cola'. */
  title: string;
}

/** One captured screen, held in memory only. */
export interface Shot {
  blob: Blob;
  mimeType: 'image/jpeg';
  /** An object URL for a thumbnail. Release it with `releaseShot`. */
  uri: string;
  /** Pixel size of the image. */
  width: number;
  height: number;
}

/** A numbered outline to draw on a capture. */
export interface CaptureMark {
  box: Box;
  /** 1-based; drawn in a badge at the outline's corner. */
  n: number;
}

/**
 * Every element the reporter itself draws carries this attribute (on web, through
 * `dataSet={{ reportUi: 'true' }}`), so picking skips it and a capture leaves it out.
 */
export const REPORT_UI_ATTR = 'data-report-ui';

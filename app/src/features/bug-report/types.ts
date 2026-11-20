import type { BugReportTarget, UploadPayload } from '@bevi/shared';

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

/**
 * One captured screen, held in memory only (its thumbnail on native is a temporary file, which
 * `releaseShot` deletes).
 */
export interface Shot {
  /**
   * What is sent: a `Blob` on the web (a canvas encoded as JPEG), bytes (a `Uint8Array`) on native,
   * where a React Native Blob would upload as an empty file (contract 3.3.0, `UploadPayload`).
   */
  file: UploadPayload;
  mimeType: 'image/jpeg';
  /** Displayable now: an object URL on the web, a `file://` URI on native. Release the shot with `releaseShot`. */
  uri: string;
  /** Pixel size of the image. */
  width: number;
  height: number;
  /** Native: the temporary file the capture was written to, as the capture library reported it. */
  tmp?: string;
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

/** What select mode tells the reporter (web only; native has none until stage 2). */
export interface PickModeHandlers {
  /** The components under the pointer or finger now, innermost first; [] when nothing can be named. */
  onHover: (levels: PickLevel[]) => void;
  /** The reporter tapped something that can be named. Select mode stays on until `stop` is called. */
  onPick: (levels: PickLevel[]) => void;
  /** Escape was pressed. */
  onCancel: () => void;
}

/** What the reporter can do on a platform (capabilities.ts, capabilities.web.ts). */
export interface Capabilities {
  select: boolean;
  steps: boolean;
  shotFirst: boolean;
  sheetsOverFullScreen: boolean;
}

// Create-Bev wizard copy (design-system voice: sentence case, second person, say what to do).

export const STEP_TITLES = ['Add a photo', 'Details', 'Did you mean…?'] as const;
export const STEP_COUNT = STEP_TITLES.length;

export const PHOTO_HINT = 'Fill the frame. A plain background helps.';
export const PROCESSING_PHOTO = 'Processing photo…';
export const UPLOADING_PHOTO = 'Uploading photo…';
export const UPLOAD_FAILED = "Your photo didn't upload. Your details are kept.";
export const UNREADABLE_IMAGE = "Bevi can't read that image. Try a JPEG or PNG.";
export const CAMERA_DENIED = 'Bevi needs the camera to take a photo. Turn it on in Settings, or choose a photo.';
export const OPEN_SETTINGS = 'Open Settings';
export const OPEN_SETTINGS_LABEL = 'Open Settings to allow the camera';
export const BARCODE_CAMERA_DENIED = 'Bevi needs the camera to scan a barcode. Turn it on in Settings, or enter the barcode below.';
export const PICKER_FAILED = "Bevi couldn't open that. Try again.";
export const STILL_PROCESSING = 'Your photo is still processing. Try again in a moment.';
// Says "You're offline" itself: the wizard is a full-screen modal, which on iOS is presented over the
// whole window and so covers the app-wide notice (src/components/OfflineNotice.tsx).
export const OFFLINE_BANNER = "You're offline. Your details are kept; add the Bev when you're back online.";

export const FIELD_REQUIRED = {
  photo: 'Add a photo of the Bev.',
  name: 'Enter a name.',
  categoryId: 'Choose a category.',
  priceTier: 'Choose a price, or "Not sure".',
} as const;

/** Under the Category field when the likely matches share a different category than the one chosen. */
export const categoryHintText = (categoryLabel: string) => `Most Bevs like this are filed under ${categoryLabel}.`;
export const categoryUseText = (categoryLabel: string) => `Use ${categoryLabel}`;
export const categoryUseLabel = (categoryLabel: string) => `Use ${categoryLabel} as the category`;

/** Under the wizard's Scan barcode button, until a scan replaces it with what it filled in. */
export const SCAN_HINT = 'Scan the barcode to fill in the details and nutrition.';
export const SCAN_NOT_FOUND = "Bevi doesn't know that barcode. Try another, or close this and enter the details yourself.";
export const SCAN_NO_NUTRITION = 'Nutrition information unavailable. Try another barcode or close this and upload a label photo.';
export const SCAN_LOOKUP_FAILED = 'Barcode lookup unavailable. Check the barcode and your connection, then try again.';

const SCAN_FIELD = { name: 'name', brand: 'brand', categoryId: 'category' } as const;
export type ScanField = keyof typeof SCAN_FIELD;

/** After the scan's notice while the label it found is still waiting for "Use this label". */
export const SCAN_CONFIRM_NUTRITION = 'Confirm the nutrition label below.';

/**
 * What a scan did to the details, said once it has: the fields it filled in (a scan never replaces
 * what was typed, so this can be none of them), and that the product lists no nutrition when it
 * doesn't.
 */
export function scanFilledText(filled: readonly ScanField[], hasNutrition: boolean): string {
  const names = filled.map((f) => SCAN_FIELD[f]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const details = names.length
    ? `Filled in the ${list} from the barcode. Check ${names.length > 1 ? 'them' : 'it'} before you continue.`
    : 'The barcode had nothing to add to your details.';
  return hasNutrition ? details : `${details} No nutrition is listed for it.`;
}

export const CATEGORY_RESTRICTED = "That category isn't available on your account.";
export const LABEL_REUPLOAD = 'Add the label photo again.';
export const PHOTO_REUPLOAD = 'Add the photo again.';

/**
 * Longest Bev name. The contract has no constant for it; the test FakeApi rejects longer names with
 * `validation` on `name`, whose message the field then shows.
 */
export const NAME_MAX_LENGTH = 80;

// Nutrition read from a photo of the label (BEV-13). A draft transcription, never a verified one.
export const LABEL_READ_NOTE = 'Read from your photo, so a number may be wrong. Check every value against the package.';
export const LABEL_READ_CONFIRM = 'These values were read from your photo. Check them against the package before you use them.';
export const LABEL_PLACEHOLDER_NAME = 'Scanned label';
export const LABEL_READ_BUTTON = 'Read nutrition from this photo';
export const LABEL_READING = 'Reading the label…';
export const LABEL_SHEET_HINT = 'Reading the Nutrition Facts panel from your photo. It works best when the whole panel is in the frame, flat on, and sharp enough to read.';
export const LABEL_NONE_FOUND = "Couldn't find a Nutrition Facts panel in that photo. Take another with the whole panel in view, flat and sharp, or continue without nutrition.";
export const LABEL_UNUSABLE_IMAGE = "Couldn't read that photo. Take it again in good light, or choose a different one.";
export const NUTRITION_SAVE_FAILED = 'Nutrition could not be saved. Scan the barcode or read the label again, or continue without it.';

/** A label read that could not name the drink is called this; the name already typed in the draft is better. */
export function nutritionWithDraftName<T extends { productName: string; source: string }>(nutrition: T, draftName: string): T {
  const name = draftName.trim();
  if (nutrition.source !== 'label-ocr' || nutrition.productName !== LABEL_PLACEHOLDER_NAME || !name) return nutrition;
  return { ...nutrition, productName: name.slice(0, NAME_MAX_LENGTH) };
}

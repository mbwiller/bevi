// Create-Bev wizard copy (design-system voice: sentence case, second person, say what to do).

export const STEP_TITLES = ['Add a photo', 'Details', 'Did you mean…?'] as const;
export const STEP_COUNT = STEP_TITLES.length;

export const PHOTO_HINT = 'Fill the frame. A plain background helps.';
export const PROCESSING_PHOTO = 'Processing photo…';
export const UPLOADING_PHOTO = 'Uploading photo…';
export const UPLOAD_FAILED = "Your photo didn't upload. Your details are kept.";
export const UNREADABLE_IMAGE = "Bevi can't read that image. Try a JPEG or PNG.";
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
export const LABEL_NONE_FOUND = "Couldn't find a Nutrition Facts panel in that photo. Take another with the whole panel in view, flat and sharp, or continue without nutrition.";
export const LABEL_UNUSABLE_IMAGE = "Couldn't read that photo. Take it again in good light, or choose a different one.";
export const NUTRITION_SAVE_FAILED = 'Nutrition could not be saved. Scan the barcode or read the label again, or continue without it.';

/** A label read that could not name the drink is called this; the name already typed in the draft is better. */
export function nutritionWithDraftName<T extends { productName: string; source: string }>(nutrition: T, draftName: string): T {
  const name = draftName.trim();
  if (nutrition.source !== 'label-ocr' || nutrition.productName !== LABEL_PLACEHOLDER_NAME || !name) return nutrition;
  return { ...nutrition, productName: name.slice(0, NAME_MAX_LENGTH) };
}

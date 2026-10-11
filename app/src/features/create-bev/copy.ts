// Create-Bev wizard copy (design-system voice: sentence case, second person, say what to do).

export const STEP_TITLES = ['Add a photo', 'Details', 'Did you mean…?'] as const;
export const STEP_COUNT = STEP_TITLES.length;

export const PHOTO_HINT = 'Fill the frame. A plain background helps.';
export const PROCESSING_PHOTO = 'Processing photo…';
export const UPLOADING_PHOTO = 'Uploading photo…';
export const UPLOAD_FAILED = "Your photo didn't upload. Your details are kept.";
export const UNREADABLE_IMAGE = "Bevi can't read that image. Try a JPEG or PNG.";
export const STILL_PROCESSING = 'Your photo is still processing. Try again in a moment.';
export const OFFLINE_BANNER = "You're offline. Your details are kept; add the Bev when you're back online.";

export const FIELD_REQUIRED = {
  photo: 'Add a photo of the Bev.',
  name: 'Enter a name.',
  categoryId: 'Choose a category.',
  priceTier: 'Choose a price, or "Not sure".',
} as const;

export const CATEGORY_RESTRICTED = "That category isn't available on your account.";
export const LABEL_REUPLOAD = 'Add the label photo again.';
export const PHOTO_REUPLOAD = 'Add the photo again.';

/**
 * Longest Bev name. The contract has no constant for it; the mock rejects longer names with
 * `validation` on `name`, whose message the field then shows.
 */
export const NAME_MAX_LENGTH = 80;

/**
 * Two values the "update required" screen (src/features/app-gate/UpdateRequired.tsx) needs. A null
 * is a value the repo does not have yet: nothing here is guessed, and the screen is written to work
 * without either.
 */

/**
 * Bevi's App Store id, digits only ("1234567890"). From App Store Connect > the app > App
 * Information > General Information > Apple ID; the same number is `ascAppId` in eas.json. Null: the
 * Update button is absent and the screen tells the person to update from TestFlight or the App Store.
 */
export const APP_STORE_ID: string | null = '6836079118';

/**
 * The address a person stuck on the update screen can write to. From the founders: the support
 * address they want shown (it should match the support URL in App Store Connect). Null: the contact
 * line is absent.
 */
export const SUPPORT_EMAIL: string | null = null;

/** The App Store page for `id`, which iOS opens in the App Store app. */
export function appStoreUrl(id: string): string {
  return `https://apps.apple.com/app/id${id}`;
}

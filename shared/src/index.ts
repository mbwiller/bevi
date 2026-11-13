/**
 * Bumped on any breaking change to the types or `BeviApi` below.
 *
 * 3.0.0, over 2.13.0's `BevSummary.iconUrl`: `CreateBevInput.photoAssetId`
 * became OPTIONAL. That is a widening for anything CONSTRUCTING the input, but
 * a breaking change for anything READING it -- every `BeviApi` implementation
 * now gets `string | undefined` where it had `string`. Both implementations
 * live in this repo and are updated, so nothing is broken today; the major
 * bump is so that an implementor outside it could not read a minor bump as
 * safe. Also adds `bevs.icons()`, `BevIcon`, `BevIconLabelBand` and
 * `IconStatus`, which are purely additive.
 *
 * Note the two distinct icon concepts, which 2.13.0 and this change
 * introduced within a day of each other: `BevSummary.iconUrl` is the AUTHORED
 * catalogue icon, served from `public.bev_icons`. `BevIcon.generatedIconUrl`
 * is the AI illustration made for a custom Bev. See `BevIcon`.
 */
export const CONTRACT_VERSION = '3.0.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';

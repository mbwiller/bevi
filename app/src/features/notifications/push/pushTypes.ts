// What push.ts and push.web.ts share. A file of its own because neither can import the other: on the
// web './push' resolves to push.web.ts (the same split as features/places/positionTypes.ts).

/**
 * What the phone says about notifications for Bevi, without asking. 'undetermined' until the person
 * has answered the iOS prompt once (iOS never asks twice, so 'denied' means only the phone's
 * Settings can turn it on); 'unavailable' where there is no push at all (the web) or it could not
 * be read.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** A push that arrived or was opened: only what the app reads from it. */
export interface PushMessage {
  /** `data.url` as the sender wrote it (send-push's `routeFor`), unchecked. Pass it through `pushRoute`. */
  url: unknown;
}

/** Stops a listener. */
export type Unsubscribe = () => void;

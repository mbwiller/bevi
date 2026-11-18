// The signed-in user's id, as every authenticated `BeviApi` method asks for it.
//
// This lived as sixteen byte-identical copies (a local `requireUserId` in
// eleven modules, plus five inline `getUser()` gates in `categories.ts` and
// `venues.ts`), all of which turned *any* failure into
// `ApiError('unauthorized')`. That is wrong in exactly one case, and it is the
// case a phone meets constantly: `auth.getUser()` is a network call to
// `/auth/v1/user`, so with the radio off it fails and every screen claims the
// person has been signed out. The app reads `'unauthorized'` from
// `profile.getMe()` as a real sign-out, so an offline launch landed on the
// sign-in screen (reported from an iOS simulator run with Wi-Fi off). One copy
// means one place to get this right.
import { ApiError } from '@bevi/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapError } from './errors';

/**
 * The signed-in user's id, or `ApiError('unauthorized')`.
 *
 * A failure that is plainly the network -- a blown `REQUEST_TIMEOUT_MS`
 * deadline (`net.ts`), or auth-js's `AuthRetryableFetchError` with `status` 0
 * from an unreachable host -- is rethrown as `ApiError('network')` instead.
 * "You are offline" is recoverable and the app must not sign anyone out over
 * it; "you are signed out" is not. Everything else still comes back as
 * `'unauthorized'`: a real 401/403, a revoked or expired token, an auth error
 * this package does not recognise, and a `getUser()` that simply answers with
 * no user. Erring towards `'unauthorized'` keeps the gate closed whenever the
 * session cannot be established, which is the safe direction.
 *
 * This deliberately stays on `getUser()`, which validates the access token
 * against the auth server, rather than the local-only `getSession()`.
 * `getSession()` would save a round trip on every authenticated call, but it
 * reads our own storage and does not check the token, so a session revoked
 * elsewhere (a sign-out on another device, a deleted account) would look
 * signed-in until some later call failed -- which moves where several flows
 * report an expired session, and is a judgement call for the humans rather
 * than part of a review fix. It would also not remove the offline failure on
 * its own: `getSession()` refreshes an expired access token, so an overnight
 * background still ends in a network call.
 */
export async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (!error && data.user) return data.user.id;
  if (error && mapError(error).code === 'network') throw mapError(error);
  throw new ApiError('unauthorized', 'Not signed in');
}

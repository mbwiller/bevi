import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, HANDLE_PATTERN, RESERVED_HANDLES, type AuthApi, type Session, type SignInInput, type SignUpInput } from '@bevi/shared';
import { emailToUsername, usernameToEmail } from './client';
import { mapError } from './errors';
import { SESSION_CHECK_TIMEOUT_MS } from './net';

function sessionFromUser(user: { id: string; email?: string | null } | null): Session | null {
  if (!user) return null;
  return { userId: user.id, handle: emailToUsername(user.email) };
}

// --------------------------------------------------------------------------
// Offline is not signed out (BEV-27)
//
// `getSession()` and `onAuthChange` are how the app decides, at launch, whether
// to show the sign-in screen. Both sit on auth-js, which answers a stored
// session whose access token has expired by refreshing it first. When that
// refresh cannot reach the server, auth-js does the right thing with the
// session -- it keeps it in storage, and removes it only when the server
// *refuses* the refresh token -- and three unhelpful things around it, which
// the code below undoes one by one (`test/offline-launch.test.ts` pins each
// against the real client):
//
//   1. It retries with backoff for up to 30 s before answering anyone. See
//      `withinSessionCheck`.
//   2. It then tells every listener INITIAL_SESSION with no session, exactly
//      as it does when nobody is signed in. See `onAuthChange`.
//   3. It remembers the failure for 60 s and answers the next refresh from
//      that memory without asking the server. See `forgetRefreshFailure`.
//
// What the app is told instead: `getSession()` rejects with
// `ApiError('network')` -- "not known", the same answer `requireUserId` gives
// for the same reason (`currentUser.ts`) -- and `onAuthChange` stays silent
// until there is something true to say.
// --------------------------------------------------------------------------

/**
 * `work`, or `ApiError('network')` once `SESSION_CHECK_TIMEOUT_MS` has passed.
 *
 * Nothing is cancelled: auth-js carries on with its refresh, and when one
 * lands the app hears the session through `onAuthChange` (TOKEN_REFRESHED).
 */
function withinSessionCheck<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiError('network', `Session check got no answer in ${SESSION_CHECK_TIMEOUT_MS} ms`)),
      SESSION_CHECK_TIMEOUT_MS,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Makes the next refresh ask the server again.
 *
 * After a failed refresh auth-js answers every further one for the same
 * refresh token from memory for 60 s (`lastRefreshFailure`,
 * `REFRESH_FAILURE_COOLDOWN_MS`). That is there to stop supabase-js's own
 * `getSession()` before each request from hammering a server that is down,
 * and it stays in force for those. But `AuthApi.getSession()` is the app
 * asking on purpose -- at launch, on Retry, when the connection returns -- and
 * answered from memory it says "offline" for up to a minute after the phone
 * is back online, with a Retry button that cannot work.
 *
 * auth-js has no public way to drop that memory: `refreshSession()` and
 * `setSession()` both go through the same cache. So this clears the field
 * auth-js itself clears after a successful refresh. It is a private field of
 * `GoTrueClient` (read in 2.117.3, the version in the lockfile); if a later
 * auth-js renames it this does nothing, the minute's wait comes back, and
 * "the next check asks the server" in `test/offline-launch.test.ts` fails.
 */
function forgetRefreshFailure(client: SupabaseClient): void {
  const auth = client.auth as unknown as { lastRefreshFailure?: unknown };
  if (auth.lastRefreshFailure) auth.lastRefreshFailure = null;
}

export function createAuthApi(client: SupabaseClient): AuthApi {
  return {
    async signUp(input: SignUpInput): Promise<Session> {
      // Pre-validated here, not left to handle_new_user's raise, because
      // GoTrue doesn't pass a trigger's raised message through to the
      // client -- confirmed against a live local stack, where a bad
      // invite code surfaced as a generic "Database error saving new
      // user", not BEVI_VALIDATION. The trigger itself stays as the race
      // backstop its own comment already says it is.
      if (!HANDLE_PATTERN.test(input.username) || RESERVED_HANDLES.includes(input.username)) {
        throw new ApiError('validation', `Invalid username: ${input.username}`, { field: 'username' });
      }

      const { data: handleOk, error: handleError } = await client.rpc('check_handle', { p_handle: input.username }).maybeSingle();
      if (handleError) throw mapError(handleError);
      const handleResult = handleOk as { available: boolean; reason: string | null } | null;
      if (handleResult && !handleResult.available) {
        if (handleResult.reason === 'taken') {
          throw new ApiError('conflict', `Username already taken: ${input.username}`);
        }
        throw new ApiError('validation', `Invalid username: ${input.username}`, { field: 'username' });
      }

      const { data: inviteOk, error: inviteError } = await client.rpc('check_invite_code', { p_code: input.inviteCode });
      if (inviteError) throw mapError(inviteError);
      if (!inviteOk) {
        throw new ApiError('validation', 'Invalid invite code', { field: 'inviteCode' });
      }

      const { data, error } = await client.auth.signUp({
        email: usernameToEmail(input.username),
        password: input.password,
        // handle_new_user (an AFTER INSERT trigger on auth.users) still
        // reads this back out as raw_user_meta_data->>'invite_code' and
        // re-checks everything above -- redundant on the happy path,
        // but the only thing that actually blocks a concurrent race.
        options: { data: { invite_code: input.inviteCode } },
      });
      if (error) throw mapError(error);
      // With "Confirm email" on, GoTrue creates the user but returns no session (it waits for an
      // email that the synthetic `@users.bevi.app` address can never receive). Fail loudly instead
      // of reporting a sign-up the user can't use.
      const session = data.session ? sessionFromUser(data.user) : null;
      if (!session) {
        throw new ApiError('unknown', 'Sign-up created no session: turn off "Confirm email" in the Supabase project (Auth settings).');
      }
      return session;
    },

    async signIn(input: SignInInput): Promise<Session> {
      const { data, error } = await client.auth.signInWithPassword({
        email: usernameToEmail(input.username),
        password: input.password,
      });
      if (error) throw mapError(error);
      const session = sessionFromUser(data.user);
      if (!session) throw mapError(new Error('signIn returned no user'));
      return session;
    },

    /**
     * Rejects with `ApiError('network')` when the stored session could not be
     * checked: its access token has expired and the refresh got no answer.
     * That is "not known", never "signed out" -- the session is still in
     * storage. `null` means there is no session.
     */
    async getSession(): Promise<Session | null> {
      forgetRefreshFailure(client);
      const { data, error } = await withinSessionCheck(client.auth.getSession());
      if (error) throw mapError(error);
      return sessionFromUser(data.session?.user ?? null);
    },

    onAuthChange(cb: (session: Session | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange((event, authSession) => {
        // INITIAL_SESSION with no session is not news. auth-js sends it both
        // when nobody is signed in and when the stored session's refresh got
        // no answer, and the two cannot be told apart from here; passed on, an
        // offline launch read as a sign-out. `getSession()` is what tells them
        // apart (null, or a rejection), and a real sign-out arrives as its own
        // SIGNED_OUT event.
        if (event === 'INITIAL_SESSION' && !authSession) return;
        cb(sessionFromUser(authSession?.user ?? null));
      });
      return () => data.subscription.unsubscribe();
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) throw mapError(error);
    },

    async deleteAccount(): Promise<void> {
      const { error } = await client.rpc('delete_my_account');
      if (error) throw mapError(error);
      await client.auth.signOut();
    },
  };
}

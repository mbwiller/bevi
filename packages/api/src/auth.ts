import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, HANDLE_PATTERN, RESERVED_HANDLES, type AuthApi, type Session, type SignInInput, type SignUpInput } from '@bevi/shared';
import { emailToUsername, usernameToEmail } from './client';
import { mapError } from './errors';

function sessionFromUser(user: { id: string; email?: string | null } | null): Session | null {
  if (!user) return null;
  return { userId: user.id, handle: emailToUsername(user.email) };
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

    async getSession(): Promise<Session | null> {
      const { data, error } = await client.auth.getSession();
      if (error) throw mapError(error);
      return sessionFromUser(data.session?.user ?? null);
    },

    onAuthChange(cb: (session: Session | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange((_event, authSession) => {
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

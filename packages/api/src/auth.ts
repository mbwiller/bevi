import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthApi, Session, SignInInput, SignUpInput } from '@bevi/shared';
import { emailToUsername, usernameToEmail } from './client';
import { mapError } from './errors';

function sessionFromUser(user: { id: string; email?: string | null } | null): Session | null {
  if (!user) return null;
  return { userId: user.id, handle: emailToUsername(user.email) };
}

export function createAuthApi(client: SupabaseClient): AuthApi {
  return {
    async signUp(input: SignUpInput): Promise<Session> {
      const { data, error } = await client.auth.signUp({
        email: usernameToEmail(input.username),
        password: input.password,
        // handle_new_user (an AFTER INSERT trigger on auth.users) reads
        // this back out as raw_user_meta_data->>'invite_code' and raises
        // (rolling back the whole signup) on a bad code, reserved/malformed
        // username, or a taken handle.
        options: { data: { invite_code: input.inviteCode } },
      });
      if (error) throw mapError(error);
      const session = sessionFromUser(data.user);
      if (!session) {
        throw mapError(new Error('signUp returned no user; "Confirm email" may not be disabled'));
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

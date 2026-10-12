import type { Profile } from '@bevi/shared';
import { create } from 'zustand';

/**
 * Where the user is in the auth flow. The root layout's gate reads it:
 * signedOut → (auth)/sign-in, onboarding → onboarding/profile, ready → the tabs.
 */
export type SessionStatus = 'signedOut' | 'onboarding' | 'ready';

/** The slice of the contract's `Profile` the shell needs (header title, tab-bar avatar). */
export type SessionProfile = Pick<Profile, 'handle' | 'displayName' | 'avatarUrl'>;

export interface SessionState {
  status: SessionStatus;
  profile?: SessionProfile;
  /**
   * False until the first auth check (`getSession`, then `getMe`) settles; the root layout shows a
   * splash meanwhile instead of flashing sign in.
   */
  checked: boolean;
  /**
   * Tests only: the status was set directly (`useSession.setState`), so the session bootstrap leaves
   * the launch check alone and only applies real auth events after it (sign-in, sign-out). Always
   * false in the app.
   */
  devForced: boolean;
  /**
   * Bumped whenever the client changes the session itself (`completeOnboarding`, `signOut`). The
   * bootstrap drops a `getMe` that started before the bump, so a stale profile (`onboarded: false`)
   * can't send a user who just finished onboarding back into it.
   */
  epoch: number;
  /**
   * A session arrived (sign-in, sign-up, `getSession` on launch, `onAuthChange`). `onboarded`
   * comes from the contract's `Profile.onboarded`; false sends the user through onboarding.
   */
  setSession: (profile: SessionProfile, onboarded?: boolean) => void;
  /** Onboarding finished (or the profile changed): status `ready`, profile updated if given. */
  completeOnboarding: (profile?: SessionProfile) => void;
  /** Signed out, account deleted, or the session expired. */
  signOut: () => void;
}

/**
 * The client-side session (one of the app's two Zustand stores, DEVELOPMENT-MATT §3). It holds no
 * data of its own: the session bootstrap (features/auth/useSessionBootstrap.ts, mounted once in the
 * root layout) calls `setSession` / `signOut` from `getSession` and `onAuthChange`. It starts
 * `signedOut` and unchecked.
 */
export const useSession = create<SessionState>()((set) => ({
  status: 'signedOut',
  profile: undefined,
  checked: false,
  devForced: false,
  epoch: 0,
  setSession: (profile, onboarded = true) => set({ profile, status: onboarded ? 'ready' : 'onboarding', checked: true }),
  completeOnboarding: (profile) => set((s) => ({ status: 'ready', profile: profile ?? s.profile, epoch: s.epoch + 1 })),
  signOut: () => set((s) => ({ status: 'signedOut', profile: undefined, checked: true, epoch: s.epoch + 1 })),
}));

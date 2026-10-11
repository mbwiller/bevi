import type { Profile } from '@bevi/shared';
import { create } from 'zustand';

import { devSessionStatus, sessionOverrideEnabled } from '@/dev/devSession';

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
   * A session arrived (sign-in, sign-up, `getSession` on launch, `onAuthChange`). `onboarded`
   * comes from the contract's `Profile.onboarded`; false sends the user through onboarding.
   */
  setSession: (profile: SessionProfile, onboarded?: boolean) => void;
  /** Onboarding finished (or the profile changed): status `ready`, profile updated if given. */
  completeOnboarding: (profile?: SessionProfile) => void;
  /** Signed out, account deleted, or the session expired. */
  signOut: () => void;
  /** Dev only: force a status (the gallery toggle). A no-op unless the dev session override is on. */
  setStatus: (status: SessionStatus) => void;
}

/**
 * The client-side session (one of the app's two Zustand stores, DEVELOPMENT-MATT §3). It holds no
 * data of its own: the API layer calls `setSession` / `signOut` from `getSession` and `onAuthChange`.
 * Until that lands, the starting status comes from the dev override (`ready` by default).
 */
export const useSession = create<SessionState>()((set) => ({
  status: devSessionStatus(),
  profile: undefined,
  setSession: (profile, onboarded = true) => set({ profile, status: onboarded ? 'ready' : 'onboarding' }),
  completeOnboarding: (profile) => set((s) => ({ status: 'ready', profile: profile ?? s.profile })),
  signOut: () => set({ status: 'signedOut', profile: undefined }),
  setStatus: (status) => {
    if (sessionOverrideEnabled()) set({ status });
  },
}));

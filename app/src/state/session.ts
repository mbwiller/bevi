import type { Profile } from '@bevi/shared';
import { create } from 'zustand';

import { devSessionOverride, sessionOverrideEnabled } from '@/dev/devSession';

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
   * splash meanwhile instead of flashing sign in. True from the start when the dev override forces
   * a status.
   */
  checked: boolean;
  /**
   * The status was forced by the dev override (`?session=`, mock only): the session bootstrap
   * leaves the launch check alone and only applies real auth events after it (sign-in, sign-out).
   */
  devForced: boolean;
  /**
   * A session arrived (sign-in, sign-up, `getSession` on launch, `onAuthChange`). `onboarded`
   * comes from the contract's `Profile.onboarded`; false sends the user through onboarding.
   */
  setSession: (profile: SessionProfile, onboarded?: boolean) => void;
  /** Onboarding finished (or the profile changed): status `ready`, profile updated if given. */
  completeOnboarding: (profile?: SessionProfile) => void;
  /** Signed out, account deleted, or the session expired. */
  signOut: () => void;
  /** Dev only: force a status (the gallery toggle, tests). A no-op unless the dev session override is on. */
  setStatus: (status: SessionStatus) => void;
}

/**
 * The client-side session (one of the app's two Zustand stores, DEVELOPMENT-MATT §3). It holds no
 * data of its own: the session bootstrap (features/auth/useSessionBootstrap.ts, mounted once in the
 * root layout) calls `setSession` / `signOut` from `getSession` and `onAuthChange`. It starts
 * `signedOut` and unchecked, unless the dev override (`?session=` on the mock) forces a status.
 */
const forced = devSessionOverride();

export const useSession = create<SessionState>()((set) => ({
  status: forced ?? 'signedOut',
  profile: undefined,
  checked: forced !== null,
  devForced: forced !== null,
  setSession: (profile, onboarded = true) => set({ profile, status: onboarded ? 'ready' : 'onboarding', checked: true }),
  completeOnboarding: (profile) => set((s) => ({ status: 'ready', profile: profile ?? s.profile })),
  signOut: () => set({ status: 'signedOut', profile: undefined, checked: true }),
  setStatus: (status) => {
    if (sessionOverrideEnabled()) set({ status, checked: true });
  },
}));

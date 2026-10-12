import { useSession, type SessionProfile } from '@/state/session';

const PROFILE: SessionProfile = { handle: 'tester', displayName: 'Test User', avatarUrl: null };

beforeEach(() => useSession.setState({ status: 'ready', profile: undefined }));

describe('session store', () => {
  it('starts signed out and unchecked, so the API decides (no sample data)', () => {
    expect(useSession.getInitialState()).toMatchObject({ status: 'signedOut', checked: false, devForced: false });
    expect(useSession.getInitialState().profile).toBeUndefined();
  });

  it('setSession and signOut mark the first check done', () => {
    useSession.setState({ checked: false });
    useSession.getState().setSession(PROFILE);
    expect(useSession.getState().checked).toBe(true);
    useSession.setState({ checked: false });
    useSession.getState().signOut();
    expect(useSession.getState().checked).toBe(true);
  });

  it('setSession: onboarded → ready, not onboarded → onboarding', () => {
    useSession.getState().setSession(PROFILE);
    expect(useSession.getState()).toMatchObject({ status: 'ready', profile: PROFILE });
    useSession.getState().setSession(PROFILE, false);
    expect(useSession.getState()).toMatchObject({ status: 'onboarding', profile: PROFILE });
  });

  it('completeOnboarding moves to ready and keeps or replaces the profile', () => {
    useSession.getState().setSession(PROFILE, false);
    useSession.getState().completeOnboarding();
    expect(useSession.getState()).toMatchObject({ status: 'ready', profile: PROFILE });
    const renamed = { ...PROFILE, displayName: 'Renamed' };
    useSession.getState().completeOnboarding(renamed);
    expect(useSession.getState().profile).toEqual(renamed);
  });

  it('signOut clears the profile', () => {
    useSession.getState().setSession(PROFILE);
    useSession.getState().signOut();
    expect(useSession.getState().status).toBe('signedOut');
    expect(useSession.getState().profile).toBeUndefined();
  });
});

import { devSessionOverride, devSessionStatus } from '@/dev/devSession';
import { useSession, type SessionProfile } from '@/state/session';

const PROFILE: SessionProfile = { handle: 'tester', displayName: 'Test User', avatarUrl: null };

beforeEach(() => useSession.setState({ status: 'ready', profile: undefined }));

describe('session store', () => {
  it('starts signed out and unchecked with no override, so the API decides (no sample data)', () => {
    expect(devSessionStatus('')).toBe('signedOut');
    expect(devSessionOverride('')).toBeNull();
    expect(useSession.getState().profile).toBeUndefined();
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

  it('setStatus forces a status (dev)', () => {
    useSession.getState().setStatus('onboarding');
    expect(useSession.getState().status).toBe('onboarding');
  });
});

describe('with the real API (EXPO_PUBLIC_BEVI_API=supabase)', () => {
  const saved = process.env.EXPO_PUBLIC_BEVI_API;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_BEVI_API = 'supabase';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_BEVI_API;
    else process.env.EXPO_PUBLIC_BEVI_API = saved;
  });

  it('ignores ?session= and starts signed out', () => {
    expect(devSessionOverride('?session=ready')).toBeNull();
    expect(devSessionStatus('?session=ready')).toBe('signedOut');
    expect(devSessionStatus(undefined)).toBe('signedOut');
  });

  it('makes setStatus a no-op', () => {
    useSession.setState({ status: 'signedOut' });
    useSession.getState().setStatus('ready');
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('still takes real sessions', () => {
    useSession.getState().setSession(PROFILE);
    expect(useSession.getState().status).toBe('ready');
  });
});

describe('devSessionStatus', () => {
  it('reads ?session= and ignores unknown values', () => {
    expect(devSessionOverride('?session=signedOut')).toBe('signedOut');
    expect(devSessionOverride('?foo=1&session=onboarding')).toBe('onboarding');
    expect(devSessionOverride('?session=ready')).toBe('ready');
    expect(devSessionOverride('?session=admin')).toBeNull();
    expect(devSessionOverride(undefined)).toBeNull();
    expect(devSessionStatus('?session=ready')).toBe('ready');
    expect(devSessionStatus('?session=admin')).toBe('signedOut');
  });
});

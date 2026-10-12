import { describe, expect, it } from 'vitest';
import { ApiError } from '@bevi/shared';
import { mapError } from '../src/errors.ts';

describe('mapError', () => {
  it('passes an existing ApiError through unchanged', () => {
    const original = new ApiError('conflict', 'already taken');
    expect(mapError(original)).toBe(original);
  });

  it('maps a BEVI_* message before falling back to the bare SQLSTATE', () => {
    // BEVI_ALREADY_RANKED and BEVI_HANDLE_TAKEN share SQLSTATE 23505, but
    // only one should ever fire for a given raise -- the message is what
    // disambiguates them.
    const e = mapError({ code: '23505', message: 'BEVI_ALREADY_RANKED', details: null });
    expect(e.code).toBe('conflict');
    const e2 = mapError({ code: '23505', message: 'BEVI_HANDLE_TAKEN', details: null });
    expect(e2.code).toBe('conflict');
  });

  it('wraps a validation detail string into { field }', () => {
    const e = mapError({ code: '22023', message: 'BEVI_VALIDATION', details: 'inviteCode' });
    expect(e.code).toBe('validation');
    expect(e.detail).toEqual({ field: 'inviteCode' });
  });

  it('falls back to the bare SQLSTATE when there is no BEVI_* name', () => {
    expect(mapError({ code: '42501', message: 'permission denied for table profiles' }).code).toBe('unauthorized');
    expect(mapError({ code: 'P0002', message: 'no rows' }).code).toBe('not_found');
    expect(mapError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }).code).toBe('not_found');
    expect(mapError({ code: '23514', message: 'new row violates check constraint "bev_reports_reason_check"' }).code).toBe('validation');
  });

  it('maps a gotrue AuthError by structured code first, then message substring', () => {
    expect(mapError({ name: 'AuthError', message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 }).code).toBe(
      'unauthorized'
    );
    expect(mapError({ name: 'AuthError', message: 'User already registered', status: 400 }).code).toBe('conflict');
  });

  it('maps a network failure', () => {
    expect(mapError(new TypeError('fetch failed')).code).toBe('network');
  });

  it('maps a storage-js StorageError by HTTP status, not through the AuthError branch', () => {
    // StorageError carries `status` too, which is isAuthErrorLike's own
    // fallback discriminator -- this only passes if the storage check in
    // mapError runs first.
    expect(mapError({ name: 'StorageApiError', message: 'The object exceeded the maximum allowed size', status: 413 }).code).toBe(
      'validation'
    );
    expect(mapError({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 403 }).code).toBe(
      'unauthorized'
    );
    expect(mapError({ name: 'StorageApiError', message: 'The resource already exists', status: 409 }).code).toBe('conflict');
    expect(mapError({ name: 'StorageUnknownError', message: 'fetch error', status: undefined }).code).toBe('unknown');
  });

  it('falls back to unknown for anything unrecognized', () => {
    expect(mapError('a plain string').code).toBe('unknown');
    expect(mapError(new Error('surprise')).code).toBe('unknown');
  });
});

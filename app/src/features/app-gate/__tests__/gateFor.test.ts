import type { AppConfig } from '@bevi/shared';

import { gateFor, parseVersion } from '../gateFor';

const config = (over: Partial<AppConfig> = {}): AppConfig => ({
  minAppVersion: '0.0.0',
  minContractVersion: '0.0.0',
  maintenance: false,
  maintenanceMessage: null,
  ...over,
});

describe('parseVersion', () => {
  it('reads strict x.y.z only', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.10.0')).toEqual([0, 10, 0]);
    for (const bad of ['', '1', '1.2', '1.2.3.4', 'a.b.c', '1.x.0', '-1.0.0', '1.0.0-beta', ' 1.0.0', '1.0.0 ', 'v1.0.0', null, undefined]) {
      expect(parseVersion(bad as string)).toBeNull();
    }
  });
});

describe('gateFor', () => {
  it('is open with no data (loading) or a failed read', () => {
    expect(gateFor(undefined, '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(null, '1.0.0', '3.2.0')).toBe('open');
  });

  it("is open at the live '0.0.0' floors", () => {
    expect(gateFor(config(), '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config(), '0.0.0', '0.0.0')).toBe('open');
  });

  it('maintenance when the flag is on, whatever the versions', () => {
    expect(gateFor(config({ maintenance: true }), '1.0.0', '3.2.0')).toBe('maintenance');
    expect(gateFor(config({ maintenance: true, minAppVersion: '9.0.0' }), '1.0.0', '3.2.0')).toBe('maintenance');
  });

  it('maintenance is honoured with no installed version (the web build)', () => {
    expect(gateFor(config({ maintenance: true }), null, '3.2.0')).toBe('maintenance');
  });

  it('update when the app is below minAppVersion', () => {
    expect(gateFor(config({ minAppVersion: '1.1.0' }), '1.0.9', '3.2.0')).toBe('update');
    expect(gateFor(config({ minAppVersion: '2.0.0' }), '1.9.9', '3.2.0')).toBe('update');
    expect(gateFor(config({ minAppVersion: '1.0.1' }), '1.0.0', '3.2.0')).toBe('update');
  });

  it('open when equal or above', () => {
    expect(gateFor(config({ minAppVersion: '1.0.0' }), '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '1.0.0' }), '1.0.1', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '1.0.0' }), '2.0.0', '3.2.0')).toBe('open');
  });

  it('compares numerically, not as strings', () => {
    expect(gateFor(config({ minAppVersion: '0.10.0' }), '0.9.0', '3.2.0')).toBe('update');
    expect(gateFor(config({ minAppVersion: '0.9.0' }), '0.10.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '1.0.0' }), '10.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minContractVersion: '3.10.0' }), '1.0.0', '3.9.0')).toBe('update');
  });

  it('update when the bundle contract is below minContractVersion', () => {
    expect(gateFor(config({ minContractVersion: '3.3.0' }), '1.0.0', '3.2.0')).toBe('update');
    expect(gateFor(config({ minContractVersion: '3.2.0' }), '1.0.0', '3.2.0')).toBe('open');
  });

  it('defaults the bundle contract to this bundle CONTRACT_VERSION', () => {
    expect(gateFor(config({ minContractVersion: '999.0.0' }), '1.0.0')).toBe('update');
    expect(gateFor(config({ minContractVersion: '0.0.0' }), '1.0.0')).toBe('open');
  });

  it('maintenance wins over update', () => {
    expect(gateFor(config({ maintenance: true, minAppVersion: '9.0.0' }), '1.0.0', '3.2.0')).toBe('maintenance');
  });

  it('fails open on garbage', () => {
    expect(gateFor(config({ minAppVersion: 'soon' }), '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '' }), '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minContractVersion: '3.2' }), '1.0.0', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '9.0.0' }), 'garbage', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '9.0.0' }), '', '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '9.0.0' }), null, '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '9.0.0' }), undefined, '3.2.0')).toBe('open');
    expect(gateFor(config({ minAppVersion: '9.0.0' }), '1.0.0', 'nope')).toBe('update');
    expect(gateFor(config({ minContractVersion: '9.0.0' }), '1.0.0', 'nope')).toBe('open');
    expect(gateFor({} as AppConfig, '1.0.0', '3.2.0')).toBe('open');
  });

  it('a malformed floor on one axis does not hide a real one on the other', () => {
    expect(gateFor(config({ minAppVersion: 'soon', minContractVersion: '9.0.0' }), '1.0.0', '3.2.0')).toBe('update');
  });
});

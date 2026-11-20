describe('installedVersion (native)', () => {
  afterEach(() => jest.resetModules());

  it('reads the native binary through expo-application', () => {
    jest.doMock('expo-application', () => ({ nativeApplicationVersion: '2.4.1', nativeBuildVersion: '57' }));
    const { installedVersion, installedBuild } = require('../installedVersion');
    expect(installedVersion()).toBe('2.4.1');
    expect(installedBuild()).toBe('57');
  });

  it('reports none when the native module has no value', () => {
    jest.doMock('expo-application', () => ({ nativeApplicationVersion: null, nativeBuildVersion: null }));
    const { installedVersion, installedBuild } = require('../installedVersion');
    expect(installedVersion()).toBeNull();
    expect(installedBuild()).toBeNull();
  });

  it('never reads the JS manifest', () => {
    const constants = jest.fn();
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { constants(); return { version: '9.9.9' }; } } }));
    jest.doMock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
    const { installedVersion } = require('../installedVersion');
    expect(installedVersion()).toBe('1.0.0');
    expect(constants).not.toHaveBeenCalled();
  });
});

describe('installedVersion (web file)', () => {
  it('reports none, so the web build is never told to update', () => {
    const web = require('../installedVersion.web');
    expect(web.installedVersion()).toBeNull();
    expect(web.installedBuild()).toBeNull();
  });
});

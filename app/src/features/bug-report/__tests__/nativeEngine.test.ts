import { isPickModeOn } from '../pickMode';
import { safeStartPickMode, safeStartStepRecording, safeStopStepRecording } from '../engine';
import { startStepRecording } from '../trail';

// The engine's guarded entry points as iOS has them (jest resolves './pickMode' and './trail' as
// iOS): select mode and step recording are stage 2, so they answer "not available", never throw.

describe('the engine on iOS', () => {
  it('has no select mode: it says it could not start, and is never on', () => {
    const handlers = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    expect(safeStartPickMode(handlers)).toBeNull();
    expect(isPickModeOn()).toBe(false);
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('has no step recording: it says it could not start, and stopping gives nothing', () => {
    expect(safeStartStepRecording('/feed', jest.fn())).toBe(false);
    expect(() => startStepRecording('/feed')).toThrow();
    expect(safeStopStepRecording()).toEqual([]);
  });
});

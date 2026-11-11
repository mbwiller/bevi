import { followedByContext, personName } from '../copy';

const SAM = { displayName: 'Sam', handle: 'sam' };
const ARJUN = { displayName: 'Arjun', handle: 'arjun' };

describe('followedByContext', () => {
  it('is nothing when nobody you follow follows them', () => {
    expect(followedByContext([], 0)).toBeUndefined();
  });

  it('names one', () => {
    expect(followedByContext([SAM], 1)).toBe('Followed by Sam');
  });

  it('names two', () => {
    expect(followedByContext([SAM, ARJUN], 2)).toBe('Followed by Sam and Arjun');
  });

  it('names two and counts the rest', () => {
    expect(followedByContext([SAM, ARJUN], 3)).toBe('Followed by Sam, Arjun and 1 other');
    expect(followedByContext([SAM, ARJUN], 5)).toBe('Followed by Sam, Arjun and 3 others');
  });

  it('names at most two, whatever the list holds', () => {
    expect(followedByContext([SAM, ARJUN, { displayName: 'Priya', handle: 'priya' }], 3)).toBe('Followed by Sam, Arjun and 1 other');
  });

  it('never counts fewer than it names', () => {
    expect(followedByContext([SAM, ARJUN], 1)).toBe('Followed by Sam and Arjun');
  });

  it('counts the rest after one name', () => {
    expect(followedByContext([SAM], 4)).toBe('Followed by Sam and 3 others');
  });

  it('falls back to the handle without a display name', () => {
    expect(followedByContext([{ displayName: '  ', handle: 'sam' }, ARJUN], 2)).toBe('Followed by @sam and Arjun');
    expect(personName({ displayName: '', handle: 'arjun' })).toBe('@arjun');
  });

  it('still says something for a count with no names', () => {
    expect(followedByContext([], 1)).toBe('Followed by 1 person you follow');
    expect(followedByContext([], 3)).toBe('Followed by 3 people you follow');
  });
});

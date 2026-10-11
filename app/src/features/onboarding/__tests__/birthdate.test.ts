import { birthdateProblem, isUnder21, maskBirthdate } from '../birthdate';

const TODAY = new Date(2026, 9, 11); // Oct 11 2026, local

describe('birthdate', () => {
  it('masks digits as YYYY-MM-DD', () => {
    expect(maskBirthdate('1990')).toBe('1990');
    expect(maskBirthdate('19900')).toBe('1990-0');
    expect(maskBirthdate('1990051')).toBe('1990-05-1');
    expect(maskBirthdate('1990-05-12')).toBe('1990-05-12');
    expect(maskBirthdate('199005123')).toBe('1990-05-12');
    expect(maskBirthdate('ab')).toBe('');
  });

  it('accepts real past dates only', () => {
    expect(birthdateProblem('1990-05', TODAY)).toBe('incomplete');
    expect(birthdateProblem('1990-02-30', TODAY)).toBe('invalid');
    expect(birthdateProblem('1899-12-31', TODAY)).toBe('invalid');
    expect(birthdateProblem('2026-10-12', TODAY)).toBe('future');
    expect(birthdateProblem('2026-10-11', TODAY)).toBeNull();
    expect(birthdateProblem('1990-05-12', TODAY)).toBeNull();
  });

  it('tells under 21 apart, birthday included', () => {
    expect(isUnder21('2005-10-11', TODAY)).toBe(false);
    expect(isUnder21('2005-10-12', TODAY)).toBe(true);
    expect(isUnder21('2010-01-01', TODAY)).toBe(true);
  });
});

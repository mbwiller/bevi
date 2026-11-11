import { bevQueryFor, searchMode } from '../panel';

it('an empty or blank bar is idle; any text shows results', () => {
  expect(searchMode('')).toBe('idle');
  expect(searchMode('   ')).toBe('idle');
  expect(searchMode('co')).toBe('results');
  expect(searchMode(' topo ')).toBe('results');
});

it('an @handle searches no Bevs; anything else searches Bevs with the same text', () => {
  expect(bevQueryFor('@sam')).toBe('');
  expect(bevQueryFor('@')).toBe('');
  expect(bevQueryFor('coke')).toBe('coke');
  expect(bevQueryFor('diet @ home')).toBe('diet @ home');
});

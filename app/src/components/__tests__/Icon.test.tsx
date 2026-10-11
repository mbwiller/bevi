import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react-native';

import { Icon, categoryIcon, iconNames } from '../Icon';

it('covers the design system icon set', () => {
  const src = readFileSync(join(__dirname, '../../../../design/system/src/icons.generated.js'), 'utf8');
  const names = [...src.matchAll(/"([a-z0-9-]+)":\[\[/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(0);
  expect([...iconNames].sort()).toEqual([...names].sort());
});

it('is decorative without a title', async () => {
  await render(<Icon name="bookmark" />);
  expect(screen.queryByRole('image')).toBeNull();
});

it('takes an accessible name from title', async () => {
  await render(<Icon name="heart" filled title="Recommended" />);
  expect(screen.getByLabelText('Recommended')).toBeTruthy();
});

it('maps categories to their icons', () => {
  expect(categoryIcon('soda')).toBe('cup-soda');
  expect(categoryIcon('diet_soda')).toBe('candy-off');
  expect(categoryIcon('spirits_cocktails')).toBe('martini');
});

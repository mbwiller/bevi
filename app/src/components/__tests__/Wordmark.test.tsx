import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react-native';

import { Wordmark } from '../Wordmark';
import { WORDMARK } from '../wordmark-data';

it('uses the same outlines as the design system', () => {
  const src = readFileSync(join(__dirname, '../../../../design/system/src/wordmark.generated.js'), 'utf8');
  const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
  expect(WORDMARK).toEqual(JSON.parse(json));
});

it('renders with an accessible name', async () => {
  await render(<Wordmark />);
  expect(screen.getByLabelText('bevi')).toBeTruthy();
});

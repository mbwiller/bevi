import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { size } from '@/theme';

import { HitTarget, hitInset, hitTargetStyle, TARGET_MIN } from '../HitTarget';

it('centres a size.target box on the visual', () => {
  expect(hitInset(30)).toBe(7);
  expect(hitInset(36)).toBe(4);
  expect(hitInset(52)).toBe(0);
  expect(hitTargetStyle(30)).toEqual({ position: 'absolute', top: -7, bottom: -7, left: -0, right: -0 });
  expect(hitTargetStyle(30, 20)).toMatchObject({ left: -12, right: -12 });
  expect(hitTargetStyle(36, undefined, 1)).toMatchObject({ top: -5, bottom: -5, left: -1, right: -1 });
});

it('renders the expander', async () => {
  await render(
    <View style={{ height: 30 }}>
      <HitTarget height={30} />
    </View>,
  );
  expect(screen.getByTestId('hit-target').props.style).toMatchObject({ top: -7, bottom: -7 });
});

it('offers a min-size box for controls that can take the space', () => {
  expect(TARGET_MIN).toMatchObject({ minWidth: size.target, minHeight: size.target });
});

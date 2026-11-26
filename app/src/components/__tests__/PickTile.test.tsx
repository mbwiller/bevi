import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { selectionHaptic } from '@/lib/haptics';
import { colors, size } from '@/theme';

import { bevArtForCategory } from '../BevArt';
import { PickTile, pickTileLabel } from '../PickTile';

jest.mock('@/lib/haptics', () => ({ selectionHaptic: jest.fn(), lightHaptic: jest.fn() }));

// The badge's pop is usePop's withSequence; Reduce Motion comes from useReducedMotion (as usePop.test).
let mockReduced = false;
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return { ...mock, useReducedMotion: () => mockReduced, withSequence: jest.fn((...steps: unknown[]) => mock.withSequence(...steps)) };
});
const { withSequence } = jest.requireMock('react-native-reanimated') as { withSequence: jest.Mock };

const light = colors.light;
const flat = (el: { props: Record<string, unknown> }) => StyleSheet.flatten(el.props.style as StyleProp<ViewStyle & TextStyle>);
const tile = (name: string) => screen.getByRole('button', { name });
const hidden = { includeHiddenElements: true };
const ART = bevArtForCategory('coffee');

beforeEach(() => {
  jest.mocked(selectionHaptic).mockClear();
  withSequence.mockClear();
  mockReduced = false;
});

it('names a tile by its label, its place once picked, and why it cannot be picked when dimmed', () => {
  expect(pickTileLabel('Coffee')).toBe('Coffee');
  expect(pickTileLabel('Coffee', 1)).toBe('Coffee, your number 1 pick');
  expect(pickTileLabel('Wine', undefined, true)).toBe("Wine. You've picked 3 already");
});

it('not picked: the label on surface with a hairline, no badge, selected false', async () => {
  await render(<PickTile label="Coffee" art={ART} onPress={() => {}} />);
  const t = tile('Coffee');
  expect(t.props.accessibilityState).toMatchObject({ selected: false, disabled: false });
  expect(t.props['aria-pressed']).toBe(false);
  expect(flat(t)).toMatchObject({ backgroundColor: light.surface, borderColor: light.border, borderWidth: 1 });
  expect(screen.queryByTestId('pick-badge', hidden)).toBeNull();
  expect(screen.getByText('Coffee', hidden)).toBeTruthy();
});

it.each([1, 2, 3] as const)('picked %i: the number badge, a primary rim on primaryTint, and the place in its name', async (rank) => {
  await render(<PickTile label="Tea" art={bevArtForCategory('tea')} rank={rank} />);
  const t = tile(`Tea, your number ${rank} pick`);
  expect(t.props.accessibilityState).toMatchObject({ selected: true });
  expect(t.props['aria-pressed']).toBe(true);
  expect(flat(t)).toMatchObject({ backgroundColor: light.primaryTint, borderColor: light.primary, borderWidth: 2 });
  const badge = screen.getByTestId('pick-badge', hidden);
  expect(flat(badge).backgroundColor).toBe(light.primary);
  expect(within(badge).getByText(String(rank), hidden)).toBeTruthy();
  expect(Number(flat(badge).minWidth)).toBeGreaterThan(0);
});

it('dimmed: the art fades, the label goes textSecondary, a press does nothing, and it says so', async () => {
  const onPress = jest.fn();
  await render(<PickTile label="Wine" art={bevArtForCategory('wine')} disabled onPress={onPress} />);
  const t = tile("Wine. You've picked 3 already");
  expect(t.props.accessibilityState).toMatchObject({ selected: false, disabled: true });
  expect(flat(screen.getByTestId('pick-art', hidden)).opacity).toBeLessThan(1);
  expect(flat(screen.getByText('Wine', hidden)).color).toBe(light.textSecondary);
  await fireEvent.press(t);
  expect(onPress).not.toHaveBeenCalled();
  expect(selectionHaptic).not.toHaveBeenCalled();
});

it('a press calls onPress and ticks the selection haptic, picked or not', async () => {
  const onPress = jest.fn();
  const { rerender } = await render(<PickTile label="Boba" art={bevArtForCategory('boba')} onPress={onPress} />);
  await fireEvent.press(tile('Boba'));
  await rerender(<PickTile label="Boba" art={bevArtForCategory('boba')} rank={1} onPress={onPress} />);
  await fireEvent.press(tile('Boba, your number 1 pick'));
  expect(onPress).toHaveBeenCalledTimes(2);
  expect(selectionHaptic).toHaveBeenCalledTimes(2);
});

it('pops the badge when a tap picks the tile, never when it drops it, and not at all under Reduce Motion', async () => {
  const { rerender } = await render(<PickTile label="Tea" art={bevArtForCategory('tea')} onPress={() => {}} />);
  await fireEvent.press(tile('Tea'));
  expect(withSequence).toHaveBeenCalledTimes(1);
  await rerender(<PickTile label="Tea" art={bevArtForCategory('tea')} rank={1} onPress={() => {}} />);
  await fireEvent.press(tile('Tea, your number 1 pick'));
  expect(withSequence).toHaveBeenCalledTimes(1);

  mockReduced = true;
  withSequence.mockClear();
  const onPress = jest.fn();
  await render(<PickTile label="Juice" art={bevArtForCategory('juice')} onPress={onPress} />);
  await fireEvent.press(tile('Juice'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(withSequence).not.toHaveBeenCalled();
});

it('draws the art through BevImage (a cutout URL, else the category art) and keeps it out of the name', async () => {
  const { rerender } = await render(<PickTile label="Soda" src="https://example.test/coke.png" />);
  expect(screen.getByTestId('pick-art', hidden).props['aria-hidden']).toBe(true);
  await rerender(<PickTile label="Smoothie" art={bevArtForCategory('smoothie')} />);
  expect(tile('Smoothie')).toBeTruthy();
});

it('is a target taller than 44pt and caps dense text scaling', async () => {
  await render(<PickTile label="Spirits & cocktails" art={bevArtForCategory('spirits_cocktails')} rank={2} />);
  // 12pt padding, the 56pt art and a line of label: well past the 44pt target.
  const t = flat(tile('Spirits & cocktails, your number 2 pick'));
  expect(Number(t.paddingVertical) * 2 + 56).toBeGreaterThan(size.target);
  expect(screen.getByText('Spirits & cocktails', hidden).props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.3);
  expect(screen.getByText('Spirits & cocktails', hidden).props.numberOfLines).toBe(2);
});

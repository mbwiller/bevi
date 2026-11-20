import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { spacing } from '@/theme';

import { Sheet } from '../Sheet';

// Jest resolves as iOS, so these are the native sheet's props. The keyboard hook is mocked: its own
// Keyboard-event plumbing is covered by useKeyboardInset's tests.
let mockKeyboard = 0;
jest.mock('@/lib/useKeyboardInset', () => ({ useKeyboardInset: () => mockKeyboard }));

const { width, height } = Dimensions.get('window');
const HOME_INDICATOR = 34;
const TOP = 59;

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
      <Sheet open title="Edit note" {...props}>
        <Text>Body</Text>
      </Sheet>
    </SafeAreaProvider>,
  );
}

const panel = () => StyleSheet.flatten(screen.getByTestId('sheet').props.style);

beforeEach(() => {
  mockKeyboard = 0;
});

it('pads the panel by xxl plus the home-indicator inset while the keyboard is down', async () => {
  await renderSheet();
  expect(panel().paddingBottom).toBe(spacing.xxl + HOME_INDICATOR);
  expect(panel().marginBottom).toBeUndefined();
});

it('rides above the keyboard: lifted by its height, padded by xxl alone (the keyboard covers the indicator)', async () => {
  mockKeyboard = 336;
  await renderSheet();
  expect(panel().marginBottom).toBe(336);
  expect(panel().paddingBottom).toBe(spacing.xxl);
});

it('shrinks a tall sheet so the lifted panel stays below the status bar', async () => {
  mockKeyboard = 336;
  await renderSheet({ snap: 90 });
  expect(panel().height).toBe(height - TOP - 336);
});

it('leaves a 40% sheet its height when it fits above the keyboard', async () => {
  mockKeyboard = 336;
  await renderSheet({ snap: 40 });
  expect(panel().height).toBeCloseTo(height * 0.4);
});

it('lets the first tap through with the keyboard up (keyboardShouldPersistTaps handled)', async () => {
  await renderSheet();
  let node = screen.getByText('Body') as unknown as { parent: { props: Record<string, unknown>; parent: unknown } | null; props: Record<string, unknown> } | null;
  while (node && node.props.keyboardShouldPersistTaps === undefined) node = node.parent as typeof node;
  expect(node?.props.keyboardShouldPersistTaps).toBe('handled');
});

it('marks the frame modal for VoiceOver, with the scrim still inside it', async () => {
  await renderSheet();
  const frame = screen.getByTestId('sheet-frame', { includeHiddenElements: true });
  expect(frame.props.accessibilityViewIsModal).toBe(true);
  let node = screen.getByTestId('sheet-scrim', { includeHiddenElements: true }) as unknown as { parent: unknown; props: { testID?: string } } | null;
  while (node && node.props.testID !== 'sheet-frame') node = node.parent as typeof node;
  expect(node).toBeTruthy();
});

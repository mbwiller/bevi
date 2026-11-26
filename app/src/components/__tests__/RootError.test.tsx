import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';

import { captureError } from '@/lib/crashReporting';
import { colors, size } from '@/theme';

import { errorDetails, RootError } from '../RootError';

// Rendered bare, as Expo Router renders it: in place of the root layout, so with no
// QueryClientProvider, no SafeAreaProvider and no gesture root around it.
jest.mock('@/lib/crashReporting', () => ({ captureError: jest.fn() }));


type Json = { props?: Record<string, unknown>; children?: unknown } | string | null;
/** The first node in the rendered tree that has a `contentContainerStyle`: the ScrollView. */
function findScroll(node: Json | Json[]): Record<string, unknown> | undefined {
  if (!node || typeof node === 'string') return undefined;
  if (Array.isArray(node)) return node.map(findScroll).find(Boolean);
  if (node.props?.contentContainerStyle !== undefined) return node.props;
  return findScroll(node.children as Json[] | null);
}

const capture = captureError as jest.MockedFunction<typeof captureError>;
const retry = jest.fn(() => Promise.resolve());

beforeEach(() => {
  capture.mockClear();
  retry.mockClear();
});

afterEach(() => jest.restoreAllMocks());

it('says what happened and what to do, with no provider around it', async () => {
  await render(<RootError error={new Error('boom')} retry={retry} />);
  expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityRole":"alert"');
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(screen.getByText('Try again. If it keeps happening, close Bevi and open it again.')).toBeTruthy();
});

it('scrolls, centred, so the message is not clipped at the largest text size, still with no provider', async () => {
  await render(<RootError error={new Error('boom')} retry={retry} />);
  const scroll = findScroll(screen.toJSON() as Json);
  expect(scroll).toBeDefined();
  expect(StyleSheet.flatten(scroll!.contentContainerStyle as object)).toMatchObject({ flexGrow: 1, justifyContent: 'center' });
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('does not show the error itself until asked', async () => {
  const error = Object.assign(new TypeError("Cannot read properties of undefined (reading 'map')"), { code: 'E_RENDER' });
  await render(<RootError error={error} retry={retry} />);
  const shown = JSON.stringify(screen.toJSON());
  expect(shown).not.toContain('Cannot read');
  expect(shown).not.toContain('TypeError');
  expect(shown).not.toContain('E_RENDER');
  expect(screen.queryByTestId('root-error-details')).toBeNull();
});

it('"Show details" shows the error\'s name, message and the top of its stack, and hides them again', async () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'map')");
  error.stack = ["TypeError: Cannot read properties of undefined (reading 'map')", '    at NotePanel (index.js:1:2)', '    at ReportNote (index.js:3:4)'].join('\n');
  await render(<RootError error={error} retry={retry} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Show details' }));
  const details = screen.getByTestId('root-error-details');
  expect(details.props.selectable).toBe(true);
  expect(details).toHaveTextContent(/^TypeError: Cannot read properties of undefined \(reading 'map'\)/);
  expect(details).toHaveTextContent(/at NotePanel/);
  expect(retry).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Hide details' }));
  expect(screen.queryByTestId('root-error-details')).toBeNull();
});

describe('errorDetails', () => {
  it('keeps the message once and at most eight lines of stack', () => {
    const error = new Error('boom');
    error.stack = ['Error: boom', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (a.js:${i}:1)`)].join('\n');
    const lines = errorDetails(error).split('\n');
    expect(lines[0]).toBe('Error: boom');
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe('at f7 (a.js:7:1)');
  });

  it('scrubs anything shaped like a credential, and copes with a thrown non-error', () => {
    const bearer = ['Bearer', 'abc.def.ghi-123456'].join(' ');
    expect(errorDetails(new Error(`request failed with ${bearer}`))).not.toContain('abc.def.ghi-123456');
    expect(errorDetails('just a string')).toBe('Error: just a string');
    expect(errorDetails(null)).toBe('Error: null');
  });
});

it('"Try again" is a labelled button with a 44pt target, and calls retry once', async () => {
  await render(<RootError error={new Error('boom')} retry={retry} />);
  const button = screen.getByRole('button', { name: 'Try again' });
  expect(button.props.accessibilityLabel).toBe('Try again');
  const visual = StyleSheet.flatten(button.props.style).height as number;
  // Two pills now (Try again, Show details): the first target is Try again's.
  const target = StyleSheet.flatten(screen.getAllByTestId('hit-target')[0]!.props.style);
  expect(target.position).toBe('absolute');
  // The pill is outlined: its 1pt border sits inside its height, and the target reaches past both edges.
  expect(visual - 2 - (target.top as number) - (target.bottom as number)).toBeGreaterThanOrEqual(size.target);
  expect(retry).not.toHaveBeenCalled();
  await fireEvent.press(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

it('reports the error once, however often it renders', async () => {
  const error = new Error('boom');
  const { rerender } = await render(<RootError error={error} retry={retry} />);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith(error, { source: 'render' });
  await rerender(<RootError error={error} retry={retry} />);
  await rerender(<RootError error={error} retry={jest.fn(() => Promise.resolve())} />);
  expect(capture).toHaveBeenCalledTimes(1);
});

it('reports a different error when one replaces it', async () => {
  const first = new Error('first');
  const second = new Error('second');
  const { rerender } = await render(<RootError error={first} retry={retry} />);
  await rerender(<RootError error={second} retry={retry} />);
  expect(capture.mock.calls.map(([error]) => error)).toEqual([first, second]);
});

it.each(['light', 'dark'] as const)('draws on the %s surface', async (scheme) => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  await render(<RootError error={new Error('boom')} retry={retry} />);
  const root = screen.toJSON();
  expect(root && !Array.isArray(root) ? StyleSheet.flatten(root.props.style) : null).toMatchObject({
    flex: 1,
    backgroundColor: colors[scheme].surface,
  });
  expect(StyleSheet.flatten(screen.getByText('Something went wrong').props.style)).toMatchObject({ color: colors[scheme].text });
});

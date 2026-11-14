import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { type } from '@/theme';

import { TextField } from '../TextField';

it('is labelled, shows its hint and reports changes', async () => {
  const onChange = jest.fn();
  await render(<TextField label="Handle" prefix="@" hint="Lowercase, 3–20 characters." onChange={onChange} id="handle" />);
  const input = screen.getByLabelText('Handle');
  expect(screen.getByText('@', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('Lowercase, 3–20 characters.')).toBeTruthy();
  expect(input.props['aria-describedby']).toBe('handle-msg');
  expect(input.props['aria-invalid']).toBeUndefined();
  await fireEvent.changeText(input, 'mbwiller');
  expect(onChange).toHaveBeenCalledWith('mbwiller');
});

it('replaces the hint with the error and marks the input invalid', async () => {
  await render(<TextField label="Handle" hint="Lowercase." error="That handle is taken." />);
  expect(screen.queryByText('Lowercase.')).toBeNull();
  expect(screen.getByText('That handle is taken.')).toBeTruthy();
  expect(screen.getByLabelText('Handle').props['aria-invalid']).toBe(true);
});

it('hides password text and skips autocapitalisation', async () => {
  await render(<TextField label="Password" type="password" autoComplete="current-password" />);
  const input = screen.getByLabelText('Password');
  expect(input.props.secureTextEntry).toBe(true);
  expect(input.props.autoCapitalize).toBe('none');
  expect(input.props.autoComplete).toBe('current-password');
});

describe('reserveHint (BEV-7)', () => {
  const line = () => screen.getByTestId('name-msg', { includeHiddenElements: true });

  it('holds one caption line open with no hint, hidden from assistive tech and not described-by', async () => {
    await render(<TextField label="Name" id="name" reserveHint />);
    expect(StyleSheet.flatten(line().props.style)).toMatchObject({ minHeight: type.caption.lineHeight });
    expect(line().props['aria-hidden']).toBe(true);
    expect(screen.getByLabelText('Name').props['aria-describedby']).toBeUndefined();
  });

  it('shows the hint in that same line when it arrives, and keeps the line when it leaves', async () => {
    const { rerender } = await render(<TextField label="Name" id="name" reserveHint />);
    await rerender(<TextField label="Name" id="name" reserveHint hint="1 Bev like this is already on Bevi." />);
    expect(screen.getByText('1 Bev like this is already on Bevi.')).toBe(line());
    expect(StyleSheet.flatten(line().props.style)).toMatchObject({ minHeight: type.caption.lineHeight });
    expect(line().props['aria-hidden']).toBeUndefined();
    expect(screen.getByLabelText('Name').props['aria-describedby']).toBe('name-msg');
    await rerender(<TextField label="Name" id="name" reserveHint />);
    expect(StyleSheet.flatten(line().props.style)).toMatchObject({ minHeight: type.caption.lineHeight });
  });

  it('without it, a field with no hint renders no line (the default is unchanged)', async () => {
    await render(<TextField label="Name" id="name" />);
    expect(screen.queryByTestId('name-msg', { includeHiddenElements: true })).toBeNull();
  });
});

import { fireEvent, render, screen } from '@testing-library/react-native';

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

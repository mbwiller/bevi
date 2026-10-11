import { fireEvent, render, screen } from '@testing-library/react-native';

import { SearchBar } from '../SearchBar';

it('is labelled by its placeholder and reports typing', async () => {
  const onChange = jest.fn();
  await render(<SearchBar placeholder="Search a Bev, brand or flavor" onChange={onChange} />);
  const input = screen.getByLabelText('Search a Bev, brand or flavor');
  expect(input.props.enterKeyHint).toBe('search');
  expect(input.props.inputMode).toBeUndefined();
  await fireEvent.changeText(input, 'horch');
  expect(onChange).toHaveBeenLastCalledWith('horch');
});

it('shows a clear button only once there is text, and clearing empties it', async () => {
  const onChange = jest.fn();
  const onClear = jest.fn();
  await render(<SearchBar onChange={onChange} onClear={onClear} />);
  expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev or a person'), 'coke');
  await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(onClear).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Search a Bev or a person').props.value).toBe('');
  expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
});

it('follows a controlled value and submits', async () => {
  const onSubmit = jest.fn();
  await render(<SearchBar value="topo" onSubmit={onSubmit} />);
  const input = screen.getByLabelText('Search a Bev or a person');
  expect(input.props.value).toBe('topo');
  await fireEvent(input, 'submitEditing', { nativeEvent: { text: 'topo' } });
  expect(onSubmit).toHaveBeenCalledWith('topo');
});

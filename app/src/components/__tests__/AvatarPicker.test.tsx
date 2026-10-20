import { fireEvent, render, screen } from '@testing-library/react-native';

import { AvatarPicker } from '../AvatarPicker';

it('with no photo: initials and "Add a photo" only', async () => {
  await render(<AvatarPicker name="Matt Willer" onChange={() => {}} onRemove={() => {}} />);
  expect(screen.getByText('MW')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  expect(screen.queryByLabelText('Uploading your photo')).toBeNull();
});

it('with a photo: "Change photo" and "Remove photo", no initials', async () => {
  await render(<AvatarPicker name="Matt Willer" src="https://example.com/m.jpg" onChange={() => {}} onRemove={() => {}} />);
  expect(screen.queryByText('MW')).toBeNull();
  expect(screen.getByRole('button', { name: 'Change photo' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull();
});

it('without onRemove there is no Remove button', async () => {
  await render(<AvatarPicker name="Matt Willer" src="https://example.com/m.jpg" onChange={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
});

it('every button is a 44pt target', async () => {
  await render(<AvatarPicker name="Matt Willer" src="https://example.com/m.jpg" onChange={() => {}} onRemove={() => {}} />);
  for (const name of ['Change photo', 'Remove photo']) {
    const style = Object.assign({}, ...[screen.getByRole('button', { name }).props.style].flat(Infinity).filter(Boolean));
    expect(style).toMatchObject({ minWidth: 44, minHeight: 44 });
  }
});

it('busy: an uploading indicator over the circle and both buttons disabled', async () => {
  const onChange = jest.fn();
  const onRemove = jest.fn();
  await render(<AvatarPicker name="Matt Willer" src="https://example.com/m.jpg" busy onChange={onChange} onRemove={onRemove} />);
  expect(screen.getByLabelText('Uploading your photo')).toBeTruthy();
  const change = screen.getByRole('button', { name: 'Change photo' });
  const remove = screen.getByRole('button', { name: 'Remove photo' });
  expect(change).toBeDisabled();
  expect(remove).toBeDisabled();
  await fireEvent.press(change);
  await fireEvent.press(remove);
  expect(onChange).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
});

it('shows the error text', async () => {
  await render(<AvatarPicker name="Matt Willer" error="Couldn't upload your photo. Try another one." />);
  expect(screen.getByText("Couldn't upload your photo. Try another one.")).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('presses call the callbacks', async () => {
  const onChange = jest.fn();
  const onRemove = jest.fn();
  await render(<AvatarPicker name="Matt Willer" src="https://example.com/m.jpg" onChange={onChange} onRemove={onRemove} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Change photo' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

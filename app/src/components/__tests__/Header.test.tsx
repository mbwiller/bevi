import { fireEvent, render, screen } from '@testing-library/react-native';

import { Header } from '../Header';
import { HeaderLeadActionProvider } from '../HeaderActionContext';

const labels = () => screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);

it('shows a title heading, labelled actions and a back button', async () => {
  const onBack = jest.fn();
  const onMore = jest.fn();
  await render(<Header title="Diet Coke" onBack={onBack} actions={[{ icon: 'ellipsis', label: 'More', onPress: onMore }]} />);
  expect(screen.getByRole('heading', { name: 'Diet Coke' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onMore).toHaveBeenCalledTimes(1);
});

it('shows the wordmark instead of a title', async () => {
  await render(<Header wordmark actions={[{ icon: 'user-plus', label: 'Find people' }]} />);
  expect(screen.getByLabelText('bevi')).toBeTruthy();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByRole('button', { name: 'Find people' })).toBeTruthy();
});

it('centres a caps title and shows action badges', async () => {
  await render(<Header centered title="Your lists" actions={[{ icon: 'settings', label: 'Settings', badge: 2 }]} />);
  expect(screen.getByRole('heading', { name: 'Your lists' })).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
});

describe('the app-wide lead action (HeaderActionContext)', () => {
  const own = [
    { icon: 'user-plus', label: 'Find people' },
    { icon: 'menu', label: 'Settings' },
  ] as const;

  it('with no provider, draws only its own actions', async () => {
    await render(<Header title="Feed" onBack={jest.fn()} actions={[...own]} />);
    expect(labels()).toEqual(['Back', 'Find people', 'Settings']);
  });

  it('with an undefined value, draws exactly what it draws without a provider', async () => {
    await render(<Header title="Feed" actions={[...own]} />);
    const before = JSON.stringify(screen.toJSON());
    await screen.rerender(
      <HeaderLeadActionProvider action={undefined}>
        <Header title="Feed" actions={[...own]} />
      </HeaderLeadActionProvider>,
    );
    expect(JSON.stringify(screen.toJSON())).toBe(before);
  });

  it('puts the provided action first, before the screen\'s own', async () => {
    const onReport = jest.fn();
    await render(
      <HeaderLeadActionProvider action={{ icon: 'triangle-alert', label: 'Report a bug', onPress: onReport }}>
        <Header title="Feed" actions={[...own]} />
      </HeaderLeadActionProvider>,
    );
    expect(labels()).toEqual(['Report a bug', 'Find people', 'Settings']);
    await fireEvent.press(screen.getByRole('button', { name: 'Report a bug' }));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('adds it to a header with no actions and to a centred one', async () => {
    await render(
      <HeaderLeadActionProvider action={{ icon: 'triangle-alert', label: 'Report a bug' }}>
        <Header centered title="Lists" />
      </HeaderLeadActionProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Lists' })).toBeTruthy();
    expect(labels()).toEqual(['Report a bug']);
  });
});

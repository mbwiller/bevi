import type { BevIcon } from '@bevi/shared';
import { render, screen } from '@testing-library/react-native';

import { GeneratedIconPanel } from '../GeneratedIconPanel';

const icon = (iconStatus: BevIcon['iconStatus'], generatedIconUrl: string | null = null): BevIcon => ({
  bevId: 'custom-bev',
  generatedIconUrl,
  iconStatus,
  fallbackIconUrl: null,
  labelBand: null,
});

it('does not show a generation panel for Bevs that were never eligible', async () => {
  await render(<GeneratedIconPanel name="Pepsi" icon={icon('none')} />);
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
});

it.each(['pending', 'processing'] as const)('explains that an illustration is being made while %s', async (status) => {
  await render(<GeneratedIconPanel name="My drink" icon={icon(status)} />);
  expect(screen.getByText('Your illustration')).toBeTruthy();
  expect(screen.getByText(/creating an illustration from your photo/i)).toBeTruthy();
});

it('shows the completed illustration and names the Bev for assistive technology', async () => {
  await render(<GeneratedIconPanel name="Mango Sparkler" icon={icon('completed', 'https://example.com/icon.png')} />);
  expect(screen.getByText('Your illustration is ready')).toBeTruthy();
  expect(screen.getByLabelText('Mango Sparkler generated illustration')).toBeTruthy();
});

it('explains a failed attempt without implying the photo was lost', async () => {
  await render(<GeneratedIconPanel name="My drink" icon={icon('failed')} />);
  expect(screen.getByText(/couldn’t create an illustration this time/i)).toBeTruthy();
  expect(screen.getByText(/your photo is still here/i)).toBeTruthy();
});

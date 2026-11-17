import type { BevIcon } from '@bevi/shared';
import { render, screen } from '@testing-library/react-native';

import { GeneratedIconPanel } from '../GeneratedIconPanel';

const icon = (iconStatus: BevIcon['iconStatus'], generatedIconUrl: string | null = null): BevIcon => ({
  bevId: 'custom-bev',
  generatedIconUrl,
  iconStatus,
  fallbackIconUrl: null,
  labelBand: iconStatus === 'completed' ? { x: 0.2, y: 0.3, width: 0.6, height: 0.18, dark: true } : null,
});

it('does not show a generation panel for Bevs that were never eligible', async () => {
  await render(<GeneratedIconPanel name="Pepsi" brand="PepsiCo" icon={icon('none')} isOwner />);
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
});

it.each([
  ['pending', 'Creating your illustration'],
  ['processing', 'Finishing your illustration'],
] as const)('shows clear owner copy and a stable shimmer tile while %s', async (status, title) => {
  await render(<GeneratedIconPanel name="My drink" brand={null} icon={icon(status)} isOwner />);
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText(/your original photo stays above/i)).toBeTruthy();
  expect(screen.getByLabelText('My drink generated illustration (illustration generation)')).toBeTruthy();
  expect(screen.getByTestId('shimmer')).toBeTruthy();
  expect(screen.getByText(title).parent?.props.accessibilityLiveRegion).toBe('polite');
});

it.each(['pending', 'processing', 'failed'] as const)('does not expose private %s job state to another viewer', async (status) => {
  await render(<GeneratedIconPanel name="My drink" brand="Acme" icon={icon(status)} isOwner={false} />);
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
});

it('shows the finished illustration to everyone and overlays the returned wordmark band', async () => {
  await render(
    <GeneratedIconPanel
      name="Mango Sparkler"
      brand="Acme"
      icon={icon('completed', 'https://example.com/icon.png')}
      isOwner={false}
    />,
  );
  expect(screen.getByText('Illustration')).toBeTruthy();
  expect(screen.getByText('A Bevi illustration for this drink.')).toBeTruthy();
  expect(screen.queryByText(/your illustration/i)).toBeNull();
  expect(screen.getByLabelText('Mango Sparkler generated illustration')).toBeTruthy();
  expect(screen.getByText('Acme')).toBeTruthy();
});

it('uses creator-specific copy for a completed illustration', async () => {
  await render(
    <GeneratedIconPanel
      name="Mango Sparkler"
      brand="Acme"
      icon={icon('completed', 'https://example.com/icon.png')}
      isOwner
    />,
  );
  expect(screen.getByText('Your illustration is ready')).toBeTruthy();
  expect(screen.getByText('Made from the photo you added.')).toBeTruthy();
});

it('explains a failed attempt without implying the photo was lost', async () => {
  await render(<GeneratedIconPanel name="My drink" brand={null} icon={icon('failed')} isOwner />);
  expect(screen.getByText('Your illustration couldn’t be created')).toBeTruthy();
  expect(screen.getByText(/your photo is still here/i)).toBeTruthy();
});

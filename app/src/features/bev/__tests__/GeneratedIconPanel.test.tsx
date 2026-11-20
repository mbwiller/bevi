import type { BevIcon } from '@bevi/shared';
import { render, screen } from '@testing-library/react-native';

import {
  generatedIconCopy,
  GeneratedIconPanel,
  ICON_JOB_STATE_VISIBLE,
  showGeneratedIcon,
} from '../GeneratedIconPanel';

const icon = (
  iconStatus: BevIcon['iconStatus'],
  generatedIconUrl: string | null = null,
  fallbackIconUrl: string | null = null,
): BevIcon => ({
  bevId: 'custom-bev',
  generatedIconUrl,
  iconStatus,
  fallbackIconUrl,
  labelBand: iconStatus === 'completed' ? { x: 0.2, y: 0.3, width: 0.6, height: 0.18, dark: true } : null,
});

describe('what the panel is allowed to show', () => {
  it('shows nothing for a Bev that was never eligible', () => {
    expect(showGeneratedIcon(icon('none'), true)).toBe(false);
  });

  it('shows nothing when the icon has not been looked up yet', () => {
    expect(showGeneratedIcon(undefined, true)).toBe(false);
    expect(showGeneratedIcon(null, true)).toBe(false);
  });

  it('shows a finished illustration to everyone', () => {
    expect(showGeneratedIcon(icon('completed', 'https://example.com/icon.png'), false)).toBe(true);
  });

  it('shows nothing for a completed row with no URL, rather than an empty tile', () => {
    expect(showGeneratedIcon(icon('completed'), true)).toBe(false);
  });

  it.each(['pending', 'processing', 'failed'] as const)('never shows %s job state to another viewer', (status) => {
    expect(showGeneratedIcon(icon(status), false)).toBe(false);
  });

  // The rollout lever: while the worker is off, a queued job never moves, so the
  // creator is told nothing instead of being promised an illustration.
  it.each(['pending', 'processing', 'failed'] as const)(
    'shows %s job state to the creator only once generation is live',
    (status) => {
      expect(showGeneratedIcon(icon(status), true)).toBe(ICON_JOB_STATE_VISIBLE);
    },
  );
});

describe('copy', () => {
  it.each(['pending', 'processing'] as const)('promises no arrival while %s', (status) => {
    const { title, message } = generatedIconCopy(icon(status), true);
    expect(title).toBe(status === 'processing' ? 'Making your illustration' : 'Illustration queued');
    expect(message).toMatch(/your original photo stays above/i);
    // The old copy said "It'll appear here when it's ready", which the rollout plan
    // forbids delivering and the one-job-a-minute drain could not honour anyway.
    expect(message).not.toMatch(/when it.s ready|appear here|shortly|soon/i);
  });

  it('explains a failed attempt without implying the photo was lost', () => {
    const { title, message } = generatedIconCopy(icon('failed'), true);
    expect(title).toBe('Your illustration couldn’t be created');
    expect(message).toMatch(/your photo is still here/i);
  });

  it('uses creator-specific copy for a completed illustration', () => {
    expect(generatedIconCopy(icon('completed', 'https://example.com/icon.png'), true)).toEqual({
      title: 'Your illustration is ready',
      message: 'Made from the photo you added.',
    });
  });

  it('tells another viewer whose photo it was made from nothing', () => {
    const { title, message } = generatedIconCopy(icon('completed', 'https://example.com/icon.png'), false);
    expect(title).toBe('Illustration');
    expect(message).toBe('A Bevi illustration for this drink.');
    expect(`${title} ${message}`).not.toMatch(/your/i);
  });
});

describe('the panel', () => {
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
    expect(screen.getByText('Illustration').parent?.props.accessibilityLiveRegion).toBe('polite');
  });

  it('falls back to the Bev name when there is no brand to set in the band', async () => {
    await render(
      <GeneratedIconPanel
        name="Mango Sparkler"
        brand={null}
        icon={icon('completed', 'https://example.com/icon.png')}
        isOwner
      />,
    );
    expect(screen.getByText('Mango Sparkler')).toBeTruthy();
  });

  it('leaves the wordmark out when the band is shorter than a line of type', async () => {
    const flat = icon('completed', 'https://example.com/icon.png');
    await render(
      <GeneratedIconPanel name="Mango Sparkler" brand="Acme" icon={{ ...flat, labelBand: { ...flat.labelBand!, height: 0.05 } }} isOwner />,
    );
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it.each([
    ['pending', 'Illustration queued'],
    ['processing', 'Making your illustration'],
  ] as const)('borrows the catalogue icon under a shimmer while %s', async (status, title) => {
    await render(
      <GeneratedIconPanel name="My drink" brand={null} icon={icon(status, null, 'https://example.com/borrowed.svg')} isOwner />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByLabelText('My drink generated illustration (illustration generation)')).toBeTruthy();
    expect(screen.getByTestId('shimmer')).toBeTruthy();
  });

  it.each(['none', 'pending', 'processing', 'failed'] as const)('renders nothing for %s to another viewer', async (status) => {
    await render(<GeneratedIconPanel name="My drink" brand="Acme" icon={icon(status)} isOwner={false} />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });

  it('renders nothing for a Bev that was never eligible', async () => {
    await render(<GeneratedIconPanel name="Pepsi" brand="PepsiCo" icon={icon('none')} isOwner />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });

  it('renders nothing for a completed row whose URL never arrived', async () => {
    await render(<GeneratedIconPanel name="My drink" brand="Acme" icon={icon('completed')} isOwner />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });
});

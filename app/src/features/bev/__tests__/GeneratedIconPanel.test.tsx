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

  // A finished illustration is the Bev's image now (`BevSummary.iconUrl`, drawn by
  // bevImageProps), so this screen says nothing about it. Before, the panel drew it
  // a second time, which made a created icon the one kind of icon with its own box.
  it('says nothing about a finished illustration, to anyone', () => {
    expect(showGeneratedIcon(icon('completed', 'https://example.com/icon.png'), true)).toBe(false);
    expect(showGeneratedIcon(icon('completed', 'https://example.com/icon.png'), false)).toBe(false);
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
    const { title, message } = generatedIconCopy(icon(status));
    expect(title).toBe(status === 'processing' ? 'Making your illustration' : 'Illustration queued');
    expect(message).toMatch(/your photo stays the bev.s image/i);
    // The old copy said "It'll appear here when it's ready", which the rollout plan
    // forbids delivering and the one-job-a-minute drain could not honour anyway.
    expect(message).not.toMatch(/when it.s ready|appear here|shortly|soon/i);
  });

  it('explains a failed attempt without implying the photo was lost', () => {
    const { title, message } = generatedIconCopy(icon('failed'));
    expect(title).toBe('Your illustration couldn’t be created');
    expect(message).toMatch(/your photo is still here/i);
  });
});

describe('the panel', () => {
  it.each([
    ['pending', 'Illustration queued'],
    ['processing', 'Making your illustration'],
  ] as const)('tells the creator that %s work is under way, and draws no tile', async (status, title) => {
    await render(<GeneratedIconPanel icon={icon(status)} isOwner />);
    expect(screen.getByText(title)).toBeTruthy();
    // No preview and no shimmer: the only picture of this Bev is its own image.
    expect(screen.queryByTestId('shimmer')).toBeNull();
    expect(screen.getByTestId('generated-icon-panel').props.accessibilityLiveRegion).toBe('polite');
  });

  it('explains a failure to its creator', async () => {
    await render(<GeneratedIconPanel icon={icon('failed')} isOwner />);
    expect(screen.getByText('Your illustration couldn’t be created')).toBeTruthy();
  });

  it.each(['none', 'pending', 'processing', 'failed'] as const)('renders nothing for %s to another viewer', async (status) => {
    await render(<GeneratedIconPanel icon={icon(status)} isOwner={false} />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });

  it('renders nothing for a Bev that was never eligible', async () => {
    await render(<GeneratedIconPanel icon={icon('none')} isOwner />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });

  it('renders nothing once the illustration is finished, because it is the Bev image', async () => {
    await render(<GeneratedIconPanel icon={icon('completed', 'https://example.com/icon.png')} isOwner />);
    expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  });
});

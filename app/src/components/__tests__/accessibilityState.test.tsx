import { BUCKET_LABEL, type BevSummary } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { SheetOption } from '@/features/lists/SheetOption';
import { FollowButton } from '@/features/people/FollowButton';

import { BucketButton } from '../BucketButton';
import { CompareCard } from '../CompareCard';
import { Pill } from '../Pill';
import { UNFOLLOW_HINT, UserRow, followLabel } from '../UserRow';

// React Native maps no `aria-pressed` on iOS, so a selected or pressed state must also be in
// `accessibilityState` for VoiceOver. The web attribute stays beside it (the suites for each component
// assert it); jest resolves as iOS, so these read the native props.

const BEV: BevSummary = {
  id: 'b7',
  name: 'Mexican Coke',
  brand: 'Coca-Cola',
  flavor: null,
  categoryId: 'soda',
  photoUrl: null,
  iconUrl: null,
  iconLabelBand: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: false,
  ratingCount: 0,
  bayesScore: null,
};

const selectedOf = (name: string | RegExp) => screen.getByRole('button', { name }).props.accessibilityState?.selected;

it('BucketButton reports selected', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" selected />
      <BucketButton bucket="FINE" />
    </>,
  );
  expect(selectedOf(BUCKET_LABEL.LOVED)).toBe(true);
  expect(selectedOf(BUCKET_LABEL.FINE)).toBe(false);
});

it('CompareCard reports selected', async () => {
  const { rerender } = await render(<CompareCard bev={BEV} selected />);
  expect(selectedOf('Mexican Coke')).toBe(true);
  await rerender(<CompareCard bev={BEV} selected={false} />);
  expect(selectedOf('Mexican Coke')).toBe(false);
});

it('an outlined Pill reports selected; a filled one is not a toggle', async () => {
  await render(
    <>
      <Pill active>Loved</Pill>
      <Pill>Fine</Pill>
      <Pill variant="filled">Rank it</Pill>
    </>,
  );
  expect(selectedOf('Loved')).toBe(true);
  expect(selectedOf('Fine')).toBe(false);
  expect(selectedOf('Rank it')).toBeFalsy();
});

it('SheetOption reports the chosen row, and nothing when it is not a choice', async () => {
  await render(
    <>
      <SheetOption label="Score" selected />
      <SheetOption label="Newest" selected={false} />
      <SheetOption label="Share" />
    </>,
  );
  expect(selectedOf('Score')).toBe(true);
  expect(selectedOf('Newest')).toBe(false);
  expect(selectedOf('Share')).toBeFalsy();
});

describe('the Follow pill says what it is and what a press does', () => {
  const USER = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };

  it('has a label per state, with an unfollow hint only while following', () => {
    expect(followLabel(false, 'Arjun Cheema')).toBe('Follow Arjun Cheema');
    expect(followLabel(true, 'Arjun Cheema')).toBe('Following Arjun Cheema');
  });

  it('UserRow: "Follow <name>", then "Following <name>" selected with the hint', async () => {
    const { rerender } = await render(<UserRow user={USER} following={false} onFollow={() => {}} />);
    const off = screen.getByRole('button', { name: 'Follow Arjun Cheema' });
    expect(off.props.accessibilityState.selected).toBe(false);
    expect(off.props.accessibilityHint).toBeUndefined();

    await rerender(<UserRow user={USER} following onFollow={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Follow Arjun Cheema' })).toBeNull();
    const on = screen.getByRole('button', { name: 'Following Arjun Cheema' });
    expect(on.props.accessibilityState.selected).toBe(true);
    expect(on.props.accessibilityHint).toBe(UNFOLLOW_HINT);
  });

  it('FollowButton (profile): the same', async () => {
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <FollowButton userId="u1" name="Arjun Cheema" following />
      </QueryClientProvider>,
    );
    const on = screen.getByRole('button', { name: 'Following Arjun Cheema' });
    expect(on.props.accessibilityState.selected).toBe(true);
    expect(on.props.accessibilityHint).toBe(UNFOLLOW_HINT);
  });
});

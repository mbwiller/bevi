import type { BevSummary } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FollowButton } from '@/features/people/FollowButton';
import { ActorLink } from '@/features/feed/FeedPostItem';
import { ProfileHero } from '@/features/profile/ProfileParts';
import { controls } from '@/testing/fakeApi';
import { size } from '@/theme';

import { BevActions, SaveButton } from '../BevParts';
import { FeedPost } from '../FeedPost';
import { usePressFeedback } from '../PressFeedback';
import { TabBar, type TabId } from '../TabBar';
import { FollowPill, UserRow } from '../UserRow';

// Where Press and Change are applied. The helpers' own suites cover what they animate; here each
// place is checked to carry them, to keep its press firing once, and to pop only on its own press.
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return { ...mock, useReducedMotion: () => false, withSequence: jest.fn(() => 1), withTiming: jest.fn(mock.withTiming) };
});
const { withSequence, withTiming } = jest.requireMock('react-native-reanimated') as { withSequence: jest.Mock; withTiming: jest.Mock };

beforeEach(() => {
  withSequence.mockClear();
  withTiming.mockClear();
});

const BEV: BevSummary = {
  id: 'b2',
  name: 'Horchata',
  brand: 'Tacos El Gordo',
  flavor: null,
  categoryId: 'other',
  photoUrl: null,
  iconUrl: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: false,
  ratingCount: 41,
  bayesScore: null,
};
const ARJUN = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };

/** The press style at rest, on whatever gives way: fully opaque, with no transform. */
const AT_REST = { opacity: 1, transform: [] };
const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('Press', () => {
  it("UserRow: the row's button gives way and fires once; the row with its divider does not move", async () => {
    const onPress = jest.fn();
    await render(<UserRow user={ARJUN} meta="84 Bevs" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Arjun Cheema, @acheema5, 84 Bevs' });
    expect(styleOf(button)).toMatchObject(AT_REST);
    expect(styleOf(screen.getByTestId('user-row')).transform).toBeUndefined();
    await fireEvent(button, 'pressIn');
    await fireEvent(button, 'pressOut');
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('FeedPost: the picture and each photo give way; a double-tap on the post still likes', async () => {
    const onOpen = jest.fn();
    const onLike = jest.fn();
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} onOpen={onOpen} onLike={onLike} />);
    const picture = screen.getByTestId('post-picture');
    expect(styleOf(picture)).toMatchObject(AT_REST);
    await fireEvent.press(picture);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await rerender(
      <FeedPost actor={ARJUN} bev={BEV} onOpen={onOpen} onLike={onLike} photos={[{ src: 'https://example.com/1.jpg' }, { src: 'https://example.com/2.jpg' }]} />,
    );
    const tiles = screen.getAllByRole('button', { name: 'Open Horchata' });
    expect(tiles).toHaveLength(2);
    for (const t of tiles) expect(styleOf(t)).toMatchObject(AT_REST);
    await fireEvent.press(screen.getByText("Arjun Bev'd Horchata"));
    await fireEvent.press(screen.getByText("Arjun Bev'd Horchata"));
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it("FeedPost's avatar gives way while the actor link over it is held", async () => {
    function Post({ onOpenActor }: { onOpenActor: () => void }) {
      const press = usePressFeedback();
      return (
        <>
          <FeedPost actor={ARJUN} bev={BEV} avatarPressStyle={press.style} />
          <ActorLink label="Arjun Cheema, @acheema5" onPress={onOpenActor} press={press} />
        </>
      );
    }
    const onOpenActor = jest.fn();
    await render(<Post onOpenActor={onOpenActor} />);
    expect(styleOf(screen.getByLabelText('Arjun Cheema').parent!)).toMatchObject(AT_REST);
    const link = screen.getByRole('link', { name: 'Arjun Cheema, @acheema5' });
    await fireEvent(link, 'pressIn');
    await fireEvent(link, 'pressOut');
    await fireEvent.press(link);
    expect(onOpenActor).toHaveBeenCalledTimes(1);
  });

  it('ProfileHero: a count with somewhere to go gives way; a count without stays plain text', async () => {
    const onFollowers = jest.fn();
    const profile = { displayName: 'Friend A', handle: 'friend_a', avatarUrl: null, createdAt: '2026-10-01T00:00:00Z' };
    await render(<ProfileHero profile={profile} stats={{ bevdCount: 12, followers: 3, following: 4 } as never} onFollowers={onFollowers} />);
    const followers = screen.getByRole('link', { name: '3 Followers' });
    expect(styleOf(followers)).toMatchObject(AT_REST);
    await fireEvent.press(followers);
    expect(onFollowers).toHaveBeenCalledTimes(1);
    expect(styleOf(screen.getByLabelText("Bev'd, 12")).transform).toBeUndefined();
  });
});

describe('Change', () => {
  it('FollowPill pops on its own press, once, and not when it re-renders with the new state', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<FollowPill following={false} name="Arjun Cheema" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Follow Arjun Cheema' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(withSequence).toHaveBeenCalledTimes(1);
    await rerender(<FollowPill following name="Arjun Cheema" onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Follow Arjun Cheema' }).props['aria-pressed']).toBe(true);
    expect(withSequence).toHaveBeenCalledTimes(1);
  });

  it('the Want to Try bookmark pops on its own press; Rank it does not', async () => {
    const onSave = jest.fn();
    const onRank = jest.fn();
    const { rerender } = await render(<BevActions name="Horchata" saved={false} onSave={onSave} onRank={onRank} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Rank Horchata' }));
    expect(withSequence).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save to Want to Try' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(withSequence).toHaveBeenCalledTimes(1);
    await rerender(<BevActions name="Horchata" saved onSave={onSave} onRank={onRank} />);
    expect(screen.getByRole('button', { name: 'Saved to Want to Try' }).props['aria-pressed']).toBe(true);
    expect(withSequence).toHaveBeenCalledTimes(1);
    expect(onRank).toHaveBeenCalledTimes(1);
  });

  it('a bookmark with no handler stays inert: no onPress, no press feedback, no pop', async () => {
    await render(<SaveButton saved={false} />);
    const save = screen.getByRole('button', { name: 'Save to Want to Try' });
    await fireEvent(save, 'pressIn');
    await fireEvent.press(save);
    expect(styleOf(save)).toMatchObject(AT_REST);
    expect(withSequence).not.toHaveBeenCalled();
    expect(withTiming).not.toHaveBeenCalled();
    expect(styleOf(screen.getByTestId('save-pop')).transform).toEqual([]);
  });

  it("FollowButton pops on its press and keeps its pressed dim and the caller's layout", async () => {
    controls.setLatency(0);
    controls.resetToFixtures();
    controls.signInAs('tester');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
    });
    const wrap = (el: ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
    await render(wrap(<FollowButton userId="nobody" name="Friend A" following={false} style={{ flex: 1 }} />));
    const button = screen.getByRole('button', { name: 'Follow Friend A' });
    expect(styleOf(button)).toMatchObject({ flex: 1, height: 36 });
    await fireEvent(button, 'pressIn');
    expect(styleOf(screen.getByRole('button', { name: 'Follow Friend A' })).filter).toBe('brightness(0.94)');
    await fireEvent(button, 'pressOut');
    expect(styleOf(screen.getByRole('button', { name: 'Follow Friend A' })).filter).toBeUndefined();
    await fireEvent.press(button);
    expect(withSequence).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.isMutating()).toBe(0));
    client.clear();
  });

  it("TabBar: the newly active tab's icon pops once; the tab showing at launch holds still", async () => {
    const metrics = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
    const bar = (active: TabId) => (
      <SafeAreaProvider initialMetrics={metrics}>
        <TabBar active={active} />
      </SafeAreaProvider>
    );
    const { rerender } = await render(bar('feed'));
    expect(withSequence).not.toHaveBeenCalled();
    await rerender(bar('lists'));
    expect(withSequence).toHaveBeenCalledTimes(1);
    await rerender(bar('lists'));
    expect(withSequence).toHaveBeenCalledTimes(1);
    // Every tab keeps its 44pt target.
    for (const b of screen.getAllByRole('button')) expect(styleOf(b).minHeight).toBe(size.target);
  });
});

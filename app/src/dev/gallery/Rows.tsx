import { ApiError, type BevSummary, type Profile } from '@bevi/shared';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BevRow } from '@/components/BevRow';
import { CompareCard } from '@/components/CompareCard';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FeaturedCard } from '@/components/FeaturedCard';
import { FeedPost } from '@/components/FeedPost';
import { ProfileListRow } from '@/components/ProfileListRow';
import { Skeleton } from '@/components/Skeleton';
import { StatCard } from '@/components/StatCard';
import { UserRow } from '@/components/UserRow';
import { spacing, type, useTheme } from '@/theme';

import { Group, Row, Specimen } from './parts';
import type { GallerySection } from './types';

// Sample data: the design system's BevRow / FeedPost / UserRow previews, as contract objects.
// These are the only sample BevSummary and Profile values in the app.
const PHOTO = '/icon-192.png';

const bev = (b: Partial<BevSummary> & Pick<BevSummary, 'id' | 'name' | 'categoryId'>): BevSummary => ({
  brand: null,
  flavor: null,
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 1,
  priceEstimated: false,
  ratingCount: 0,
  bayesScore: null,
  ...b,
});

const BEVS = {
  dietCoke: bev({ id: 'b1', name: 'Diet Coke', brand: 'Coca-Cola', flavor: 'Original', categoryId: 'diet_soda', ratingCount: 362, bayesScore: 8.4 }),
  horchata: bev({ id: 'b2', name: 'Horchata', brand: 'Tacos El Gordo', flavor: 'Cinnamon', categoryId: 'other', priceTier: 2, ratingCount: 41 }),
  brownSugar: bev({
    id: 'b3',
    name: 'Brown Sugar Boba',
    brand: 'Tiger Sugar',
    categoryId: 'boba',
    priceTier: 2,
    priceEstimated: true,
    ratingCount: 5120,
    bayesScore: 7.3,
  }),
  poppi: bev({ id: 'b4', name: 'Poppi Strawberry Lemon', brand: 'Poppi', flavor: 'Strawberry Lemon', categoryId: 'soda', priceTier: 2, ratingCount: 58 }),
  topo: bev({ id: 'b5', name: 'Topo Chico', brand: 'Topo Chico', categoryId: 'sparkling_water', photoUrl: PHOTO, ratingCount: 210 }),
  matcha: bev({ id: 'b6', name: 'Oat Milk Matcha', brand: null, categoryId: 'tea', priceTier: 3, photoUrl: PHOTO, photoStatus: 'processing' }),
  mexicanCoke: bev({ id: 'b7', name: 'Mexican Coke', brand: 'Coca-Cola', categoryId: 'soda', priceTier: 2 }),
};

const person = (id: string, displayName: string, handle: string, avatarUrl: string | null = null): Profile => ({
  id,
  handle,
  displayName,
  avatarUrl,
  timezone: 'America/Los_Angeles',
  createdAt: '2026-09-01T00:00:00Z',
  birthdate: null,
  canSeeAlcohol: true,
  onboarded: true,
});

const ARJUN = person('u1', 'Arjun Cheema', 'acheema5');
const PRIYA = person('u2', 'Priya Natarajan', 'priyan', PHOTO);
const SAM = person('u3', 'Sam Okafor', 'samo');
const ME = person('u4', 'Matt Willer', 'mattw');

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;
const LONG_NOTE =
  'cinnamon-forward, not too sweet, and the rice milk is thinner than most places which honestly works better on a hot day. ' +
  'best thing on the block, and the cup is enormous for the price. would get again with extra ice.';

const noop = () => {};

/** Rows are full-bleed with their own gutter; this cancels the gallery's padding. */
function Bleed({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.bleed, { borderTopColor: colors.border }]}>{children}</View>;
}

function Note({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[type.caption, { color: colors.textSecondary }]}>{children}</Text>;
}

function BevRows() {
  const [saved, setSaved] = useState<Record<string, boolean>>({ b3: true });
  const toggle = (id: string) => () => setSaved((s) => ({ ...s, [id]: !s[id] }));
  const common = (b: BevSummary) => ({ bev: b, saved: !!saved[b.id], onSave: toggle(b.id), onRank: noop, onPress: noop });
  return (
    <Bleed>
      <BevRow {...common(BEVS.dietCoke)} number={1} score={9.3} bucket="LOVED" meta="Ranked Oct 3" />
      <BevRow {...common(BEVS.horchata)} number={2} score={6.1} meta="Ranked Sep 28" />
      <BevRow {...common(BEVS.brownSugar)} score={7.3} count={5120} meta="Saved from @acheema5" />
      <BevRow {...common(BEVS.poppi)} score={8.2} scoreVariant="predicted" count={58} meta="You love diet sodas" />
      <BevRow {...common(BEVS.mexicanCoke)} score={null} scoreVariant="locked" meta="Rank 3 more to unlock" />
      <BevRow {...common(BEVS.topo)} showImage score={3.2} meta="Search result with a photo" />
      <BevRow {...common(BEVS.matcha)} showImage meta="Photo processing, no score" />
      <BevRow {...common(BEVS.horchata)} showImage actions={false} score={8.8} meta="No actions, BevArt fallback" divider={false} />
    </Bleed>
  );
}

function FeedPosts() {
  const [saved, setSaved] = useState(false);
  return (
    <Bleed>
      <FeedPost actor={ARJUN} bev={BEVS.horchata} score={9.5} time={ago(5 * HOUR)} note={LONG_NOTE} saved={saved} onSave={() => setSaved(!saved)} onRank={noop} onOpen={noop} />
      <FeedPost actor={PRIYA} bev={BEVS.topo} score={5.4} bucket="FINE" time={ago(20 * 60_000)} note="tastes like flat Sprite, in a good way" onSave={noop} onRank={noop} onOpen={noop} />
      <FeedPost actor={SAM} verb="saved" bev={BEVS.brownSugar} saved time={ago(3 * 24 * HOUR)} onSave={noop} onRank={noop} />
      <FeedPost you actor={ME} bev={BEVS.matcha} score={2.8} time={ago(30_000)} onSave={noop} onRank={noop} onOpen={noop} />
      <FeedPost actor={ARJUN} bev={BEVS.dietCoke} score={null} scoreVariant="locked" time={ago(20 * 24 * HOUR)} onSave={noop} divider={false} />
    </Bleed>
  );
}

function UserRows() {
  const [following, setFollowing] = useState<Record<string, boolean>>({ u1: true });
  const follow = (id: string) => () => setFollowing((f) => ({ ...f, [id]: !f[id] }));
  return (
    <Bleed>
      <UserRow user={ARJUN} meta="84 Bevs" following={!!following.u1} onFollow={follow('u1')} onPress={noop} />
      <UserRow user={PRIYA} meta="31 Bevs" following={!!following.u2} onFollow={follow('u2')} onPress={noop} />
      <UserRow user={SAM} rank={1} meta="212 pts" streak={14} onPress={noop} />
      <UserRow user={ME} rank={12} meta="96 pts" streak={4} self following={false} onPress={noop} divider={false} />
    </Bleed>
  );
}

function CompareCards() {
  const [pick, setPick] = useState<string | null>('b7');
  return (
    <View style={styles.stack}>
      <CompareCard bev={BEVS.horchata} isNew selected={pick === 'b2'} onPress={() => setPick('b2')} />
      <CompareCard bev={BEVS.mexicanCoke} rankLabel="#3 in Loved" selected={pick === 'b7'} onPress={() => setPick('b7')} />
      <CompareCard bev={BEVS.topo} rankLabel="#1 in Fine" onPress={noop} />
    </View>
  );
}

function Rows() {
  return (
    <View>
      <Group title="BevRow">
        <Note>Numbered with bucket colour, band colour, global count, predicted, locked, photo, processing, no actions. Tap the bookmark to save.</Note>
        <BevRows />
      </Group>

      <Group title="FeedPost">
        <Note>Ranked with a long note (tap to expand), ranked with a short note, saved, you, locked.</Note>
        <FeedPosts />
      </Group>

      <Group title="FeaturedCard">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
          <FeaturedCard title="Brown Sugar Boba" subtitle="Boba • $$" art={{ kind: 'boba', color: '#c8955c', accent: '#3b2416' }} tint="#e9d3bd" onPress={noop} />
          <FeaturedCard title="Top 10 Sparkling Waters" subtitle="You've had 3 of 10" art={{ kind: 'slimCan', color: '#9fd3c7', accent: '#ffffff' }} tint="#cfe8e0" onPress={noop} />
          <FeaturedCard title="Topo Chico" subtitle="Sparkling water • $" src={PHOTO} onPress={noop} />
        </ScrollView>
      </Group>

      <Group title="ProfileListRow">
        <Bleed>
          <ProfileListRow icon="circle-check" label="Bev'd" count={42} onPress={noop} />
          <ProfileListRow icon="bookmark" iconFilled label="Want to Try" count={7} onPress={noop} />
          <ProfileListRow icon="heart" label="Recommended for you" onPress={noop} divider={false} />
        </Bleed>
      </Group>

      <Group title="StatCard">
        <View style={styles.pair}>
          <View style={styles.half}>
            <StatCard icon="trophy" label="Rank on Bevi" value="#12" onPress={noop} />
          </View>
          <View style={styles.half}>
            <StatCard icon="flame" label="Current Streak" value="4 days" />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.half}>
            <StatCard icon="trophy" label="Rank on Bevi" value="Unranked" />
          </View>
          <View style={styles.half}>
            <StatCard icon="flame" label="Current Streak" value="Rank today to start" />
          </View>
        </View>
      </Group>

      <Group title="UserRow">
        <Note>Following, follow, leaderboard with streak, your own row.</Note>
        <UserRows />
      </Group>

      <Group title="CompareCard">
        <CompareCards />
      </Group>

      <Group title="EmptyState">
        <EmptyState icon="users" title="Follow friends to see their Bevs" body="Rankings from people you follow show up here. Featured Bevs stay above." action="Find people" onAction={noop} />
        <EmptyState icon="bookmark" title="Nothing in Want to Try yet" body="Tap the bookmark on any Bev to save it here." />
      </Group>

      <Group title="ErrorState">
        <ErrorState error={new ApiError('network', 'offline')} onRetry={noop} />
        <ErrorState error={new ApiError('not_found', 'gone')} onRetry={noop} />
        <ErrorState error={new ApiError('rate_limited', 'slow down')} onRetry={noop} />
        <ErrorState error={new Error('boom')} onRetry={noop} />
      </Group>

      <Group title="Skeleton">
        <Row align="flex-start">
          <Specimen label="circle">
            <Skeleton variant="circle" width={44} />
          </Specimen>
          <Specimen label="block">
            <Skeleton variant="block" width={120} height={80} />
          </Specimen>
        </Row>
        <Skeleton variant="text" lines={3} />
        <Bleed>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="post" />
        </Bleed>
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter, borderTopWidth: 1 },
  stack: { gap: spacing.md },
  carousel: { gap: spacing.lg },
  // StatCards: two per row, 10pt apart (StatCard README).
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});

export const rows: GallerySection = { id: 'rows', title: 'Rows, cards and states', Component: Rows };

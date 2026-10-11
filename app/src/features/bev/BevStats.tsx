import { MIN_N_USER } from '@bevi/ranking';
import type { Bev } from '@bevi/shared';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AvatarStack } from '@/components/AvatarStack';
import { ScoreBubble } from '@/components/ScoreBubble';
import { BUCKET_SHORT, MIN_CONFIDENCE, PREDICTION_LOCKED } from '@/features/lists/copy';
import { formatScore } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

function StatTile({ label, meta, children }: { label: string; meta: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { borderColor: colors.border }]}>
      {children}
      <View style={styles.tileText}>
        <Text {...DENSE} style={[type.heading, styles.center, { color: colors.text }]}>
          {label}
        </Text>
        <Text {...DENSE} style={[type.body, styles.center, { color: colors.textSecondary }]}>
          {meta}
        </Text>
      </View>
    </View>
  );
}

const ratings = (n: number) => `${n} rating${n === 1 ? '' : 's'}`;

/**
 * The two stat tiles (§6.11): "Bevi score" (global Bayesian + count) and either your own score
 * ("#4 in Loved"), "You'd rate it" (predicted), or a lock with why.
 */
export function BevStats({ bev, myRankingCount }: { bev: Bev; myRankingCount: number | undefined }) {
  const mine = bev.myRanking;
  const prediction = bev.prediction;
  const hasPrediction = !!prediction && prediction.confidence >= MIN_CONFIDENCE;
  const tooFew = (myRankingCount ?? 0) < MIN_N_USER;
  return (
    <View style={styles.stats}>
      <StatTile
        label="Bevi score"
        meta={bev.ratingCount === 0 ? 'Be the first' : ratings(bev.ratingCount)}
      >
        <ScoreBubble size={56} score={bev.bayesScore} count={bev.bayesScore != null ? bev.ratingCount : undefined} />
      </StatTile>
      {mine ? (
        <StatTile label="Your score" meta={`#${mine.position + 1} in ${BUCKET_SHORT[mine.bucket]}`}>
          <ScoreBubble size={56} score={mine.score} bucket={mine.bucket} />
        </StatTile>
      ) : hasPrediction ? (
        <StatTile label="You'd rate it" meta="from your tastes">
          <ScoreBubble size={56} score={prediction.score} variant="predicted" />
        </StatTile>
      ) : (
        <StatTile label="You'd rate it" meta={tooFew ? PREDICTION_LOCKED : 'Not enough to go on yet'}>
          <ScoreBubble size={56} variant="locked" />
        </StatTile>
      )}
    </View>
  );
}

/** "Friends who've had it": first two with scores, then "N more", and an AvatarStack. */
export function FriendsRow({ friends }: { friends: Bev['friends'] }) {
  const { colors } = useTheme();
  if (friends.length === 0) return null;
  const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
  const named = friends.slice(0, 2).map((f) => `${firstName(f.profile.displayName)} ${formatScore(f.score)}`);
  const more = friends.length - named.length;
  const line = [...named, ...(more > 0 ? [`${more} more`] : [])].join(' · ');
  return (
    <View style={styles.friends}>
      <View style={styles.friendsText}>
        <Text {...DENSE} style={[type.heading, { color: colors.text }]}>
          Friends who've had it
        </Text>
        <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <AvatarStack
        people={friends.map((f) => ({ name: f.profile.displayName, src: f.profile.avatarUrl ?? undefined }))}
        max={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md },
  tile: {
    flex: 1,
    flexBasis: 0,
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.stat,
  },
  tileText: { alignItems: 'center' },
  center: { textAlign: 'center' },
  friends: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.lg,
  },
  friendsText: { flex: 1, minWidth: 0 },
});

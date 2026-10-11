import type { BevSummary, Bucket, Profile } from '@bevi/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { categoryById } from '@/lib/categories';
import { formatRelativeTime } from '@/lib/time';
import { size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import type { BevArtProps } from './BevArt';
import { BevActions, bevImageProps } from './BevParts';
import { BevImage } from './BevImage';
import { Icon } from './Icon';
import { PriceTier } from './PriceTier';
import { ScoreBubble } from './ScoreBubble';

export type FeedActor = Pick<Profile, 'displayName' | 'handle' | 'avatarUrl'>;

export interface FeedPostProps {
  actor?: FeedActor;
  /** The viewer's own post: "You Bev'd …". */
  you?: boolean;
  verb?: 'ranked' | 'saved';
  bev: BevSummary;
  score?: number | null;
  scoreVariant?: 'default' | 'predicted' | 'locked';
  /** The actor's bucket: the bubble takes the bucket colour. */
  bucket?: Bucket | null;
  note?: string | null;
  /** ISO timestamp, printed as "5 hours ago" or a weekday. */
  time?: string;
  saved?: boolean;
  /** Strip tiles; defaults to the Bev's own photo on a ranking, none on a save. */
  photos?: { src?: string; art?: BevArtProps }[];
  onRank?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Notes longer than this truncate with "See more" (FeedPost README). */
const NOTE_MAX = 160;
const NOTE_CUT = 150;

/** A ranking or a save in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**". */
export function FeedPost({
  actor,
  you = false,
  verb = 'ranked',
  bev,
  score,
  scoreVariant,
  bucket,
  note,
  time,
  saved = false,
  photos,
  onRank,
  onSave,
  onOpen,
  divider = true,
  style,
}: FeedPostProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const cat = categoryById(bev.categoryId);
  const isSave = verb === 'saved';
  const name = actor?.displayName ?? '';
  const who = you ? 'You' : name.split(' ')[0] || (actor ? `@${actor.handle}` : '');
  const image = bevImageProps(bev);
  const tiles = photos ?? (isSave ? [] : [{ src: image.src, art: image.art }]);
  const long = !!note && note.length > NOTE_MAX;
  const shown = note && long && !open ? `${note.slice(0, NOTE_CUT).replace(/\s+\S*$/, '')} …` : note;
  const textColor = { color: colors.text };

  const noteText = note ? (
    <Text style={[type.bodyLarge, textColor]}>
      <Text style={styles.bold}>Notes:</Text> {shown}
      {long && !open ? <Text style={{ color: colors.textSecondary }}> See more</Text> : null}
    </Text>
  ) : null;

  return (
    <View
      style={[
        styles.post,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      <View style={styles.head}>
        <Avatar name={name || who} src={actor?.avatarUrl ?? undefined} size={60} />
        <View style={styles.headText}>
          <Text style={[type.screenTitle, textColor]}>
            <Text>{who}</Text>
            <Text style={styles.verb}>{isSave ? ' saved ' : " Bev'd "}</Text>
            <Text>{bev.name}</Text>
          </Text>
          <View style={styles.meta}>
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.textSecondary} /> : null}
            <Text style={[type.body, styles.shrink, { color: colors.textSecondary }]} numberOfLines={1}>
              {bev.brand ? `${bev.brand} • ` : ''}
              <PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} />
            </Text>
          </View>
        </View>
        {!isSave && (score != null || scoreVariant) ? (
          <ScoreBubble score={score} variant={scoreVariant} bucket={bucket ?? undefined} style={styles.score} />
        ) : null}
      </View>

      {tiles.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
          {tiles.map((t, i) => (
            <Pressable key={i} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${bev.name}`}>
              <BevImage
                size={size.bevImageStrip}
                src={t.src}
                art={t.art}
                alt={bev.name}
                status={!photos && i === 0 ? image.status : 'ready'}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {noteText ? (
        long && !open ? (
          // The whole note expands, so "See more" has a full-width target rather than a 20pt word.
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Notes: ${shown} See more`}
            style={[styles.note, styles.noteTarget]}
          >
            {noteText}
          </Pressable>
        ) : (
          <View style={styles.note}>{noteText}</View>
        )
      ) : null}

      <View style={styles.foot}>
        <Text style={[type.body, { color: colors.textSecondary }]}>{time ? formatRelativeTime(time) : ''}</Text>
        <BevActions name={bev.name} saved={saved} onRank={onRank} onSave={onSave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  post: { paddingTop: spacing.lg, paddingBottom: spacing.xs, paddingHorizontal: spacing.gutter },
  divider: { borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxl },
  headText: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
  verb: { fontWeight: '400' },
  bold: { fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  shrink: { flexShrink: 1, minWidth: 0 },
  score: { marginTop: spacing.xs },
  strip: { marginTop: spacing.lg, marginHorizontal: -spacing.gutter },
  stripContent: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  note: { marginTop: spacing.lg },
  noteTarget: { minHeight: size.target },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.target,
    marginTop: spacing.sm,
  },
});

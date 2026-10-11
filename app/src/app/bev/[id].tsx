import { isApiError } from '@bevi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAddWantToTry, useBev, useMe, useRemoveWantToTry, useStats } from '@/api/hooks';
import { bevImageProps, brandLine } from '@/components/BevParts';
import { BevImage } from '@/components/BevImage';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { PriceTier } from '@/components/PriceTier';
import { Skeleton } from '@/components/Skeleton';
import { BevStats, FriendsRow } from '@/features/bev/BevStats';
import { ReportSheet } from '@/features/bev/ReportSheet';
import { categoryById } from '@/lib/categories';
import { useBack } from '@/lib/useBack';
import { radius, size, spacing, type, useTheme } from '@/theme';

const HERO = size.bevImageStrip;

function DetailSkeleton() {
  return (
    <View style={styles.hero} accessibilityLabel="Loading">
      <Skeleton variant="block" width={HERO} height={HERO} />
      <Skeleton width={HERO} height={22} />
      <Skeleton width={HERO * 0.7} />
      <View style={[styles.stats, styles.skeletonStats]}>
        <Skeleton variant="block" width="48%" height={140} />
        <Skeleton variant="block" width="48%" height={140} />
      </View>
    </View>
  );
}

/** Bev detail (§6.11): hero, Bevi score and your score or prediction, friends, Rank it and Want to Try. */
export default function BevDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBev(id);
  const me = useMe();
  const stats = useStats();
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();
  const [reporting, setReporting] = useState(false);

  const bev = query.data;
  const cat = bev ? categoryById(bev.categoryId) : undefined;
  // The server already refuses these (`age_restricted`); this covers a cached Bev after the profile changes.
  const hidden = !!cat?.isAlcoholic && me.data?.canSeeAlcohol === false;
  const code = isApiError(query.error) ? query.error.code : undefined;

  const header = (
    <Header
      onBack={back}
      actions={bev && !hidden ? [{ icon: 'ellipsis', label: 'More', onPress: () => setReporting(true) }] : []}
    />
  );

  let body;
  if (query.isPending) {
    body = <DetailSkeleton />;
  } else if (hidden || code === 'age_restricted') {
    body = <ErrorState title="Not available" message="This Bev isn't available on your account." icon="lock" />;
  } else if (code === 'not_found') {
    body = (
      <EmptyState
        icon="search"
        title="This Bev isn't here anymore"
        body="It may have been removed or merged. Search for it on the Add tab."
        action="Search Bevs"
        onAction={() => router.replace('/add')}
      />
    );
  } else if (!bev) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    const brand = brandLine(bev);
    const photo = bev.photoUrl;
    const ranked = !!bev.myRanking;
    const image = <BevImage size={HERO} {...bevImageProps(bev)} />;
    body = (
      <>
        <View style={styles.hero}>
          {photo ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={`View photo of ${bev.name}`}
              onPress={() => router.push({ pathname: '/image/[url]', params: { url: photo } })}
              style={({ pressed }) => pressed && PRESSED}
            >
              {image}
            </Pressable>
          ) : (
            image
          )}
          <Text style={[type.screenTitle, styles.name, styles.center, { color: colors.text }]} accessibilityRole="header">
            {bev.name}
          </Text>
          {brand ? <Text style={[type.body, styles.center, { color: colors.textSecondary }]}>{brand}</Text> : null}
          <View style={styles.catLine}>
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.text} /> : null}
            <Text style={[type.body, { color: colors.text }]}>
              {cat ? `${cat.label} • ` : ''}
              <PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} />
            </Text>
          </View>
        </View>

        <BevStats bev={bev} myRankingCount={stats.data?.bevdCount} />

        {bev.myRanking?.note ? (
          <View style={[styles.note, { borderColor: colors.border }]}>
            <Text style={[type.sectionCaps, { color: colors.textSecondary }]}>Your note</Text>
            <Text style={[type.bodyLarge, { color: colors.text }]}>{bev.myRanking.note}</Text>
          </View>
        ) : null}

        <FriendsRow friends={bev.friends} />

        <View style={[styles.buttons, bev.friends.length === 0 && styles.buttonsGap]}>
          <Pill
            variant="filled"
            icon={ranked ? 'arrow-up-down' : 'circle-plus'}
            style={styles.button}
            accessibilityLabel={ranked ? `Re-rank ${bev.name}` : `Rank ${bev.name}`}
            onPress={() =>
              router.push({
                pathname: '/rank/[bevId]',
                params: ranked ? { bevId: bev.id, mode: 'rerank' } : { bevId: bev.id },
              })
            }
          >
            {ranked ? 'Re-rank' : 'Rank it'}
          </Pill>
          {ranked ? null : (
            <Pill
              variant="outlined"
              icon="bookmark"
              active={bev.inWantToTry}
              style={styles.button}
              accessibilityLabel={bev.inWantToTry ? 'Saved to Want to Try' : 'Save to Want to Try'}
              onPress={() => (bev.inWantToTry ? remove.mutate(bev.id) : add.mutate({ bevId: bev.id }))}
            >
              Want to Try
            </Pill>
          )}
        </View>

        {bev.nutritionLabelUrl ? (
          <Pill
            icon="file-text"
            style={styles.label}
            accessibilityLabel={`View nutrition label for ${bev.name}`}
            onPress={() => router.push({ pathname: '/image/[url]', params: { url: bev.nutritionLabelUrl! } })}
          >
            Nutrition label
          </Pill>
        ) : null}

        {bev.createdBy ? (
          <Text style={[type.caption, styles.center, styles.footer, { color: colors.textSecondary }]}>
            {`Added by @${bev.createdBy.handle}`}
          </Text>
        ) : null}

        <ReportSheet bevId={bev.id} name={bev.name} open={reporting} onClose={() => setReporting(false)} />
      </>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>{body}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: spacing.xxl },
  hero: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.lg, paddingHorizontal: spacing.gutter },
  name: { marginTop: spacing.md },
  center: { textAlign: 'center' },
  catLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.md },
  skeletonStats: { alignSelf: 'stretch', justifyContent: 'space-between', marginTop: spacing.lg },
  note: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  buttons: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.gutter },
  buttonsGap: { marginTop: spacing.xl },
  button: { flex: 1, justifyContent: 'center', minHeight: size.target },
  label: { alignSelf: 'center', marginTop: spacing.xl },
  footer: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xxl },
});

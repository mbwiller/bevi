import type { BevSummary, Venue } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { openLabel, venueMeta, websiteLink } from '@/lib/venue';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { SectionHeader } from './SectionHeader';
import { Skeleton } from './Skeleton';

export const VENUE_GONE = "This spot isn't here anymore";
export const OSM_CREDIT = '© OpenStreetMap contributors';

export interface VenueSheetProps {
  venue?: Venue | null;
  openNow?: boolean | null;
  /** "Bevs here (N)": the pin's count while the rows load, then the rows'. */
  bevCount?: number;
  loading?: boolean;
  /** `not_found`: "This spot isn't here anymore". */
  notFound?: boolean;
  /** Any other failure (an ErrorState with Retry). */
  error?: unknown;
  onRetry?: () => void;
  onClose?: () => void;
  /** The Bevs here. A venue can carry a hundred, so they are a virtualised list: only rows in view mount. */
  bevs?: readonly BevSummary[];
  /**
   * One BevRow. React Native adaptation of the design system's `VenueBev`: each row reads the viewer's
   * own score for its Bev, so the caller renders it.
   */
  renderBev?: (bev: BevSummary) => ReactElement;
  style?: StyleProp<ViewStyle>;
}

const NO_BEVS: readonly BevSummary[] = [];
const bevKey = (b: BevSummary) => b.id;

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;
/** The Sheet's handle bar (bundle.css `.bv-sheet-handle`). */
const HANDLE = { width: 36, height: 5 };

/**
 * The tapped venue, docked under the full-screen map (design system VenueSheet): the map shrinks above
 * it, so the raised pin, Google's logo and the OpenStreetMap credit stay in view. Name, kind ·
 * neighborhood · borough, open state, address, website, "Bevs here (N)" and the credit.
 */
export function VenueSheet({
  venue,
  openNow = null,
  bevCount,
  loading = false,
  notFound = false,
  error,
  onRetry,
  onClose,
  bevs = NO_BEVS,
  renderBev,
  style,
}: VenueSheetProps) {
  const { colors } = useTheme();
  const site = venue ? websiteLink(venue.website) : null;
  const meta = venue ? venueMeta(venue, true) : '';
  const head = venue && !notFound;
  const rows = !notFound && !error && !loading && renderBev ? bevs : NO_BEVS;
  const renderItem = useCallback(({ item }: { item: BevSummary }) => renderBev?.(item) ?? null, [renderBev]);
  let body: ReactNode;
  if (notFound) body = <EmptyState icon="map-pin" title={VENUE_GONE} body="It may have closed, or it no longer carries any Bevs." />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} />;
  else
    body = (
      <>
        <SectionHeader title={`Bevs here (${bevCount ?? 0})`} />
        {loading ? (
          <View accessibilityLabel="Loading Bevs" aria-busy>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </View>
        ) : rows.length ? null : (
          <EmptyState icon="cup-soda" title="No Bevs listed here yet" body="Spots show up on the map once we know what they carry." />
        )}
      </>
    );
  return (
    <View
      testID="venue-sheet"
      accessibilityLabel={venue?.name ?? 'Spot'}
      {...({ role: 'region' } as object)}
      style={[styles.sheet, { backgroundColor: colors.surface, borderTopColor: colors.border }, style]}
    >
      <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} aria-hidden />
      <FlashList
        style={styles.scroll}
        data={rows}
        renderItem={renderItem}
        keyExtractor={bevKey}
        ListHeaderComponent={
          <>
            <View style={[styles.title, !head && styles.titleEnd]}>
              {head ? (
                <Text {...DENSE} style={[type.screenTitle, styles.name, { color: colors.text }]} accessibilityRole="header">
                  {venue.name}
                </Text>
              ) : null}
              <IconButton icon="x" variant="filled" label="Close" onPress={onClose} />
            </View>
            {head ? (
              <View style={styles.head}>
                {meta ? (
                  <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]}>
                    {meta}
                  </Text>
                ) : null}
                <View style={styles.line}>
                  <Icon name="clock" size={16} strokeWidth={2} color={colors.text} />
                  <Text {...DENSE} style={[type.body, { color: colors.text }]}>
                    {openLabel(openNow)}
                  </Text>
                </View>
                {venue.address ? (
                  <View style={styles.line}>
                    <Icon name="map-pin" size={16} strokeWidth={2} color={colors.text} />
                    <Text {...DENSE} style={[type.body, styles.shrink, { color: colors.text }]}>
                      {venue.address}
                    </Text>
                  </View>
                ) : null}
                {site ? (
                  <Pressable
                    // On the web a real anchor (react-native-web renders `href` as <a>), so it opens in a new
                    // tab and the browser's own link affordances work; elsewhere the OS opens it.
                    {...(Platform.OS === 'web'
                      ? ({ href: site.href, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as object)
                      : { onPress: () => void Linking.openURL(site.href) })}
                    accessibilityRole="link"
                    accessibilityLabel={`Website, ${site.label}`}
                    style={styles.link}
                  >
                    <Text {...DENSE} style={[type.body, styles.linkText, { color: colors.primary }]} numberOfLines={1}>
                      {site.label}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {body}
          </>
        }
        ListFooterComponent={
          <Text {...DENSE} style={[type.caption, styles.credit, { color: colors.textSecondary }]}>
            {OSM_CREDIT}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  handle: { alignSelf: 'center', ...HANDLE, marginBottom: spacing.xs, borderRadius: radius.pill },
  scroll: { flex: 1 },
  title: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.xs,
  },
  titleEnd: { justifyContent: 'flex-end' },
  // Lines the name up with the close circle's middle (its 44pt target).
  name: { flex: 1, paddingTop: (size.target - type.screenTitle.lineHeight) / 2 },
  head: { gap: 2, paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shrink: { flexShrink: 1 },
  link: { alignSelf: 'flex-start', minHeight: size.target, justifyContent: 'center' },
  linkText: { fontWeight: '600' },
  credit: { paddingTop: spacing.md, paddingBottom: spacing.lg, paddingHorizontal: spacing.gutter },
});

import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { size, spacing } from '@/theme';

import { FilterPill } from './FilterPill';
import { hitInset } from './HitTarget';
import { Pill } from './Pill';

export interface MapFilterRowProps {
  /** Facets that are on, for "Filters N". */
  count?: number;
  /** false leaves the Neighborhood pill out (no vocabulary yet). */
  neighborhoods?: boolean;
  /** Each facet: the label of what is picked ('' for nothing). */
  neighborhood?: string;
  category?: string;
  price?: string;
  retailer?: string;
  openNow?: boolean;
  onFilters?: () => void;
  onNeighborhood?: () => void;
  onCategory?: () => void;
  onPrice?: () => void;
  onRetailer?: () => void;
  onOpenNow?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-mapfilters { gap: 10px }`: the Pill README's 10–12pt between pills. */
const GAP = 10;

/**
 * The filters over the map, one row that scrolls sideways (design system MapFilterRow): Filters N,
 * Neighborhood, Category, Price, Open now and Retailer. A pill that is on takes the selected look.
 */
export function MapFilterRow({
  count = 0,
  neighborhoods = true,
  neighborhood = '',
  category = '',
  price = '',
  retailer = '',
  openNow = false,
  onFilters,
  onNeighborhood,
  onCategory,
  onPrice,
  onRetailer,
  onOpenNow,
  style,
}: MapFilterRowProps) {
  const facet = (picked: string, name: string, onPress?: () => void) => (
    <Pill variant="outlined" iconRight="chevron-down" active={!!picked} onPress={onPress} accessibilityLabel={picked ? `${name}: ${picked}` : name}>
      {picked || name}
    </Pill>
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="toolbar"
      accessibilityLabel="Map filters"
      testID="map-filter-row"
      style={[styles.row, style]}
      contentContainerStyle={styles.content}
    >
      <FilterPill label="Filters" count={count} onPress={onFilters} />
      {neighborhoods ? facet(neighborhood, 'Neighborhood', onNeighborhood) : null}
      {facet(category, 'Category', onCategory)}
      {facet(price, 'Price', onPrice)}
      <Pill variant="outlined" active={openNow} onPress={onOpenNow}>
        Open now
      </Pill>
      {facet(retailer, 'Retailer', onRetailer)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0 },
  // The ScrollView clips: pad it so each pill's 44pt target stays inside (HitTarget).
  content: { gap: GAP, paddingHorizontal: spacing.gutter, paddingVertical: hitInset(size.pill) },
});

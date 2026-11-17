import type { CategoryId, PriceTier, VenueFilters, VenueKind } from '@bevi/shared';
import { useState, type ReactNode } from 'react';

import { MapFilterRow } from '@/components/MapFilterRow';
import { Sheet } from '@/components/Sheet';
import { SheetOption, SheetSection } from '@/features/lists/SheetOption';
import { visibleCategories } from '@/lib/categories';
import { KIND_PLURAL, VENUE_KINDS } from '@/lib/venue';

import { activeFilterCount, pickedLabels, PRICE_TIERS, priceLabel, toggled } from './filters';

type Facet = 'neighborhood' | 'category' | 'price' | 'retailer';

export interface MapFiltersProps {
  /** The usable filters (`usableFilters`): what the pills show and `venues.inView` gets. */
  filters: VenueFilters;
  onChange: (filters: VenueFilters) => void;
  canSeeAlcohol: boolean;
  /** `venues.neighborhoods()`; empty leaves the Neighborhood pill out. */
  neighborhoods: readonly string[];
}

const TITLE: Record<Facet, string> = { neighborhood: 'Neighborhood', category: 'Category', price: 'Price', retailer: 'Retailer' };

/**
 * The map's filter row and its sheets (§1c): each ▾ pill opens a multi-select Sheet ("Any …" clears
 * it), Open now toggles in place, and "Filters N" opens one Sheet with every filter and Reset.
 * Picking nothing means no filter.
 */
export function MapFilters({ filters, onChange, canSeeAlcohol, neighborhoods }: MapFiltersProps) {
  const [open, setOpen] = useState<Facet | 'all' | null>(null);
  const picked = pickedLabels(filters);
  const count = activeFilterCount(filters);
  const close = () => setOpen(null);
  const set = (patch: Partial<VenueFilters>) => onChange({ ...filters, ...patch });

  const options: Record<Facet, () => ReactNode> = {
    neighborhood: () => (
      <>
        <SheetOption label="Any neighborhood" selected={!filters.neighborhoods?.length} onPress={() => set({ neighborhoods: [] })} />
        {neighborhoods.map((n) => (
          <SheetOption key={n} label={n} selected={!!filters.neighborhoods?.includes(n)} onPress={() => set({ neighborhoods: toggled(filters.neighborhoods, n) })} />
        ))}
      </>
    ),
    category: () => (
      <>
        <SheetOption label="Any category" icon="list" selected={!filters.categoryIds?.length} onPress={() => set({ categoryIds: [] })} />
        {visibleCategories(canSeeAlcohol).map((c) => (
          <SheetOption
            key={c.id}
            label={c.label}
            icon={c.icon}
            selected={!!filters.categoryIds?.includes(c.id)}
            onPress={() => set({ categoryIds: toggled<CategoryId>(filters.categoryIds, c.id) })}
          />
        ))}
      </>
    ),
    price: () => (
      <>
        <SheetOption label="Any price" selected={!filters.priceTiers?.length} onPress={() => set({ priceTiers: [] })} />
        {PRICE_TIERS.map((t) => (
          <SheetOption key={t} label={priceLabel(t)} selected={!!filters.priceTiers?.includes(t)} onPress={() => set({ priceTiers: toggled<PriceTier>(filters.priceTiers, t) })} />
        ))}
      </>
    ),
    retailer: () => (
      <>
        <SheetOption label="Any retailer" selected={!filters.kinds?.length} onPress={() => set({ kinds: [] })} />
        {VENUE_KINDS.map((k) => (
          <SheetOption key={k} label={KIND_PLURAL[k]} selected={!!filters.kinds?.includes(k)} onPress={() => set({ kinds: toggled<VenueKind>(filters.kinds, k) })} />
        ))}
      </>
    ),
  };
  // The facet sheet keeps its title and options while it slides away.
  const [facet, setFacet] = useState<Facet>('category');
  const openFacet = (f: Facet) => {
    setFacet(f);
    setOpen(f);
  };
  const hasHoods = neighborhoods.length > 0;

  return (
    <>
      <MapFilterRow
        count={count}
        neighborhoods={hasHoods}
        {...picked}
        openNow={!!filters.openNow}
        onFilters={() => setOpen('all')}
        onNeighborhood={() => openFacet('neighborhood')}
        onCategory={() => openFacet('category')}
        onPrice={() => openFacet('price')}
        onRetailer={() => openFacet('retailer')}
        onOpenNow={() => set({ openNow: !filters.openNow })}
      />
      <Sheet open={open === facet} title={TITLE[facet]} snap={facet === 'category' || facet === 'neighborhood' ? 90 : 40} onClose={close}>
        {options[facet]()}
      </Sheet>
      <Sheet open={open === 'all'} title="Filters" snap={90} onClose={close}>
        {count > 0 ? <SheetOption label="Reset filters" icon="x" onPress={() => onChange({})} /> : null}
        <SheetOption label="Open now" icon="clock" selected={!!filters.openNow} onPress={() => set({ openNow: !filters.openNow })} />
        <SheetSection title="Retailer" />
        {options.retailer()}
        <SheetSection title="Price" />
        {options.price()}
        {hasHoods ? (
          <>
            <SheetSection title="Neighborhood" />
            {options.neighborhood()}
          </>
        ) : null}
        <SheetSection title="Category" />
        {options.category()}
      </Sheet>
    </>
  );
}

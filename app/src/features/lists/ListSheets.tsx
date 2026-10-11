import { BUCKET_ORDER, type Bucket, type CategoryId } from '@bevi/shared';

import { Sheet } from '@/components/Sheet';
import type { CategoryInfo } from '@/lib/categories';

import { BUCKET_SHORT } from './copy';
import { SheetOption, SheetSection } from './SheetOption';

export type BucketCounts = Partial<Record<Bucket, number>>;

const countOf = (counts: BucketCounts | undefined, b: Bucket) => (counts?.[b] != null ? String(counts[b]) : undefined);

function CategoryOptions({
  categories,
  value,
  onSelect,
}: {
  categories: readonly CategoryInfo[];
  value: CategoryId | undefined;
  onSelect: (id: CategoryId | undefined) => void;
}) {
  return (
    <>
      <SheetOption label="All Bevs" icon="list" selected={value === undefined} onPress={() => onSelect(undefined)} />
      {categories.map((c) => (
        <SheetOption key={c.id} label={c.label} icon={c.icon} selected={value === c.id} onPress={() => onSelect(c.id)} />
      ))}
    </>
  );
}

function BucketOptions({
  value,
  counts,
  onSelect,
}: {
  value: Bucket | undefined;
  counts?: BucketCounts;
  onSelect: (b: Bucket | undefined) => void;
}) {
  return (
    <>
      <SheetOption label="All buckets" selected={value === undefined} onPress={() => onSelect(undefined)} />
      {BUCKET_ORDER.map((b) => (
        <SheetOption key={b} label={BUCKET_SHORT[b]} detail={countOf(counts, b)} selected={value === b} onPress={() => onSelect(b)} />
      ))}
    </>
  );
}

/** The ListScopeDropdown's category picker: "All Bevs" + the categories this user may see. */
export function CategorySheet({
  open,
  categories,
  value,
  onSelect,
  onClose,
}: {
  open: boolean;
  categories: readonly CategoryInfo[];
  value: CategoryId | undefined;
  onSelect: (id: CategoryId | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Show" snap={90} onClose={onClose}>
      <CategoryOptions
        categories={categories}
        value={value}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
      />
    </Sheet>
  );
}

/** Bev'd bucket filter with a count per bucket when known. */
export function BucketSheet({
  open,
  value,
  counts,
  onSelect,
  onClose,
}: {
  open: boolean;
  value: Bucket | undefined;
  counts?: BucketCounts;
  onSelect: (b: Bucket | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Bucket" onClose={onClose}>
      <BucketOptions
        value={value}
        counts={counts}
        onSelect={(b) => {
          onSelect(b);
          onClose();
        }}
      />
    </Sheet>
  );
}

/** The FilterPill's sheet (§6.19): bucket (Bev'd only) and category, plus Clear filters. */
export function FilterSheet({
  open,
  bucket,
  counts,
  categories,
  categoryId,
  onBucket,
  onCategory,
  onClose,
}: {
  open: boolean;
  /** Omit `onBucket` to hide the bucket section (Want to Try, Recommended). */
  bucket?: Bucket;
  counts?: BucketCounts;
  categories: readonly CategoryInfo[];
  categoryId: CategoryId | undefined;
  onBucket?: (b: Bucket | undefined) => void;
  onCategory: (id: CategoryId | undefined) => void;
  onClose: () => void;
}) {
  const active = (onBucket && bucket ? 1 : 0) + (categoryId ? 1 : 0);
  return (
    <Sheet open={open} title="Filters" snap={90} onClose={onClose}>
      {active > 0 ? (
        <SheetOption
          label="Clear filters"
          icon="x"
          onPress={() => {
            onBucket?.(undefined);
            onCategory(undefined);
            onClose();
          }}
        />
      ) : null}
      {onBucket ? (
        <>
          <SheetSection title="Bucket" />
          <BucketOptions value={bucket} counts={counts} onSelect={onBucket} />
        </>
      ) : null}
      <SheetSection title="Category" />
      <CategoryOptions categories={categories} value={categoryId} onSelect={onCategory} />
    </Sheet>
  );
}

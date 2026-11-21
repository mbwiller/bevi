import type { BarcodeProduct, CategoryId, PriceTier, NutritionPreview } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { Button } from '@/components/Button';
import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { PriceTierPicker } from '@/components/PriceTierPicker';
import { TextField } from '@/components/TextField';
import { categoryById, type CategoryInfo } from '@/lib/categories';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { NutritionScanResult, NutritionScanSheet, useNutritionScan } from './NutritionScan';
import { categoryHintText, NAME_MAX_LENGTH, categoryUseLabel, categoryUseText, SCAN_CONFIRM_NUTRITION, SCAN_HINT } from './copy';
import { PhotoStatusLine } from './PhotoStep';
import type { PhotoSource } from './photo';
import type { PhotoUpload } from './usePhotoUpload';

export interface DetailsForm {
  name: string;
  brand: string;
  flavor: string;
  categoryId: CategoryId | null;
  priceTier: PriceTier | null;
  priceEstimated: boolean;
}

export type FieldErrors = Partial<Record<'photo' | 'name' | 'brand' | 'flavor' | 'categoryId' | 'priceTier' | 'label' | 'nutrition', string>>;

export interface DetailsStepProps {
  form: DetailsForm;
  errors: FieldErrors;
  onChange: (patch: Partial<DetailsForm>) => void;
  onOpenCategories: () => void;
  label: PhotoUpload;
  nutrition: NutritionPreview | null;
  onNutritionChange: (value: NutritionPreview | null) => void;
  /** The label the last scan found, confirmed or not. The wizard keeps it so it outlives this step. */
  scanned: NutritionPreview | null;
  onScannedChange: (value: NutritionPreview | null) => void;
  /** A barcode scan found the product: the wizard fills in the fields above from it. */
  onProduct: (product: BarcodeProduct) => void;
  /** What the last scan filled in, in place of the hint under Scan barcode. */
  scanNotice?: string | null;
  onPickLabel: (source: PhotoSource) => void;
  /** "2 Bevs like this are already on Bevi" while typing. */
  similarCount: number;
  /** The category the likely matches share, when it isn't the one chosen ("Most Bevs like this are filed under Energy."). */
  categoryHint?: CategoryInfo | null;
  /** "Use Energy": sets the category to the hinted one. */
  onUseCategory?: (id: CategoryId) => void;
}

/** A field-styled button that opens the category sheet. */
function CategoryField({ value, error, onPress }: { value: CategoryId | null; error?: string; onPress: () => void }) {
  const { colors } = useTheme();
  const cat = value ? categoryById(value) : null;
  return (
    <View style={styles.field}>
      <Text style={[type.caption, styles.label, { color: colors.textSecondary }]}>Category</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cat ? `Category, ${cat.label}` : 'Choose a category'}
        aria-invalid={error ? true : undefined}
        onPress={onPress}
        style={({ pressed }) => [
          styles.box,
          { borderColor: error ? colors.scoreLow : colors.borderStrong, backgroundColor: colors.surface },
          pressed && PRESSED,
        ]}
      >
        {cat ? <Icon name={cat.icon} size={20} strokeWidth={2} color={colors.text} /> : null}
        <Text style={[type.bodyLarge, styles.flex, { color: cat ? colors.text : colors.textSecondary }]} numberOfLines={1}>
          {cat ? cat.label : 'Choose a category'}
        </Text>
        <Icon name="chevron-down" size={20} strokeWidth={2} color={colors.textSecondary} />
      </Pressable>
      {error ? (
        <Text style={[type.caption, { color: colors.scoreLow }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Step 2: name, brand, flavor, category, price, and an optional nutrition label photo. A barcode scan
 * at the top fills in what the product database knows; the label it found waits with the nutrition.
 */
export function DetailsStep({ form, errors, onChange, onOpenCategories, label, onPickLabel, nutrition, onNutritionChange, scanned, onScannedChange, onProduct, scanNotice = null, similarCount, categoryHint = null, onUseCategory }: DetailsStepProps) {
  const { colors } = useTheme();
  const scan = useNutritionScan({ value: nutrition, onChange: onNutritionChange, onProduct, scanned, onScanned: onScannedChange });
  const hasLabel = !!label.photo;
  // The label a scan found is attached only by "Use this label", further down than the fields the
  // same scan filled in: say so for as long as it is waiting there.
  const unconfirmed = !!scan.nutrition && scan.nutrition !== nutrition;
  const notice = scanNotice ? (unconfirmed ? `${scanNotice} ${SCAN_CONFIRM_NUTRITION}` : scanNotice) : null;
  return (
    <View style={styles.body}>
      {scan.available ? (
        <View style={styles.field}>
          <Button variant="outlined" icon="camera" onPress={scan.start} accessibilityLabel="Scan barcode to fill in details">
            Scan barcode
          </Button>
          {/* A live region from the start: one added together with its text is not announced on the web. iOS is told by the wizard. */}
          <Text style={[type.caption, { color: colors.textSecondary }]} role="status" accessibilityLiveRegion="polite">
            {notice ?? SCAN_HINT}
          </Text>
        </View>
      ) : null}
      <TextField
        label="Name"
        placeholder="Mexican Coke"
        value={form.name}
        onChange={(name) => onChange({ name })}
        error={errors.name}
        hint={similarCount > 0 ? `${similarCount === 1 ? '1 Bev like this is' : `${similarCount} Bevs like this are`} already on Bevi.` : undefined}
        // The hint comes and goes with every lookup while typing; its line stays open so Brand and the rest don't jump (BEV-7).
        reserveHint
        maxLength={NAME_MAX_LENGTH}
        autoCapitalize="words"
      />
      <TextField
        label="Brand or shop (optional)"
        placeholder="Coca-Cola"
        value={form.brand}
        onChange={(brand) => onChange({ brand })}
        error={errors.brand}
        autoCapitalize="words"
      />
      <TextField
        label="Flavor (optional)"
        placeholder="Cherry"
        value={form.flavor}
        onChange={(flavor) => onChange({ flavor })}
        error={errors.flavor}
        autoCapitalize="words"
      />
      <View style={styles.categoryGroup}>
        <CategoryField value={form.categoryId} error={errors.categoryId} onPress={onOpenCategories} />
        {categoryHint ? (
          <View style={styles.hintRow} accessibilityLiveRegion="polite">
            <Text style={[type.caption, styles.flex, { color: colors.textSecondary }]}>{categoryHintText(categoryHint.label)}</Text>
            <Button
              variant="ghost"
              onPress={() => onUseCategory?.(categoryHint.id)}
              accessibilityLabel={categoryUseLabel(categoryHint.label)}
            >
              {categoryUseText(categoryHint.label)}
            </Button>
          </View>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={[type.caption, styles.label, { color: colors.textSecondary }]}>Price</Text>
        <PriceTierPicker
          value={form.priceTier}
          estimated={form.priceEstimated}
          onChange={(priceTier, priceEstimated) => onChange({ priceTier, priceEstimated })}
        />
        {errors.priceTier ? (
          <Text style={[type.caption, { color: colors.scoreLow }]} accessibilityLiveRegion="polite">
            {errors.priceTier}
          </Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={[type.caption, styles.label, { color: colors.textSecondary }]}>Nutrition label (optional)</Text>
        <NutritionScanResult scan={scan} />
        {errors.nutrition ? <Text role="alert" style={[type.caption, { color: colors.scoreLow }]}>{errors.nutrition}</Text> : null}
        <View style={styles.labelRow}>
          <BevImage size={size.scoreBubbleLg} src={label.photo?.uri} alt={hasLabel ? 'Nutrition label photo' : 'No label photo'} />
          <View style={styles.labelActions}>
            <Button variant="outlined" icon="file-text" onPress={() => onPickLabel('library')} accessibilityLabel={hasLabel ? 'Replace label photo' : 'Add label photo'}>
              {hasLabel ? 'Replace' : 'Add label'}
            </Button>
            {label.phase !== 'empty' ? (
              <Button variant="ghost" onPress={label.clear} accessibilityLabel="Remove label photo">
                Remove
              </Button>
            ) : null}
          </View>
        </View>
        <PhotoStatusLine slot={label} />
        {errors.label ? (
          <Text style={[type.caption, { color: colors.scoreLow }]} role="alert">
            {errors.label}
          </Text>
        ) : null}
      </View>
      <NutritionScanSheet scan={scan} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  field: { gap: spacing.sm, alignSelf: 'stretch' },
  label: { fontWeight: '600' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: size.target + spacing.xs,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  flex: { flex: 1 },
  categoryGroup: { gap: spacing.xs, alignSelf: 'stretch' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  labelActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 },
});

import type { CategoryId, PriceTier } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BevImage } from '@/components/BevImage';
import { Button } from '@/components/Button';
import { PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { PriceTierPicker } from '@/components/PriceTierPicker';
import { TextField } from '@/components/TextField';
import { categoryById } from '@/lib/categories';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { NAME_MAX_LENGTH } from './copy';
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

export type FieldErrors = Partial<Record<'photo' | 'name' | 'brand' | 'flavor' | 'categoryId' | 'priceTier' | 'label', string>>;

export interface DetailsStepProps {
  form: DetailsForm;
  errors: FieldErrors;
  onChange: (patch: Partial<DetailsForm>) => void;
  onOpenCategories: () => void;
  label: PhotoUpload;
  onPickLabel: (source: PhotoSource) => void;
  /** "2 Bevs like this are already on Bevi" while typing. */
  similarCount: number;
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

/** Step 2: name, brand, flavor, category, price, and an optional nutrition label photo. */
export function DetailsStep({ form, errors, onChange, onOpenCategories, label, onPickLabel, similarCount }: DetailsStepProps) {
  const { colors } = useTheme();
  const hasLabel = !!label.photo;
  return (
    <View style={styles.body}>
      <TextField
        label="Name"
        placeholder="Mexican Coke"
        value={form.name}
        onChange={(name) => onChange({ name })}
        error={errors.name}
        hint={similarCount > 0 ? `${similarCount === 1 ? '1 Bev like this is' : `${similarCount} Bevs like this are`} already on Bevi.` : undefined}
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
      <CategoryField value={form.categoryId} error={errors.categoryId} onPress={onOpenCategories} />
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
        <View style={styles.labelRow}>
          <BevImage size={size.scoreBubbleLg} src={label.photo?.uri} alt={hasLabel ? 'Nutrition label photo' : 'No label photo'} />
          <View style={styles.labelActions}>
            <Button variant="outlined" icon="file-text" onPress={() => onPickLabel('library')} accessibilityLabel={hasLabel ? 'Replace label photo' : 'Add label photo'}>
              {hasLabel ? 'Replace' : 'Add label'}
            </Button>
            {hasLabel ? (
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
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  labelActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 },
});

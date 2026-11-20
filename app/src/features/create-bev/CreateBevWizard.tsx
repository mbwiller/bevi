import { isApiError, type BarcodeProduct, type CategoryId, type NutritionPreview, type BevSummary, type CreateBevInput, type FindDuplicatesInput, type ValidationErrorDetail } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBev, useCategories, useCreateBev, useLikelyDuplicates, useMe } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { ProgressDots } from '@/components/ProgressDots';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { formErrorMessage } from '@/features/auth/formError';
import { categoryById, visibleCategories } from '@/lib/categories';
import { announce } from '@/lib/useAnnounce';
import { useBack } from '@/lib/useBack';
import { useOnline } from '@/lib/useOnline';
import { radius, spacing, type, useTheme } from '@/theme';

import {
  CATEGORY_RESTRICTED,
  FIELD_REQUIRED,
  LABEL_REUPLOAD,
  OFFLINE_BANNER,
  PHOTO_REUPLOAD,
  SCAN_CONFIRM_NUTRITION,
  scanFilledText,
  type ScanField,
  STEP_COUNT,
  STEP_TITLES,
  STILL_PROCESSING,
  UNREADABLE_IMAGE,
  UPLOAD_FAILED,
} from './copy';
import { suggestCategory } from './categoryHint';
import { createWhenReady, isAssetNotReady } from './createWhenReady';
import { DetailsStep, type DetailsForm, type FieldErrors } from './DetailsStep';
import { DuplicatesStep, ExistingBev } from './DuplicatesStep';
import { PhotoStep } from './PhotoStep';
import { isUnsupportedImage, type PhotoSource } from './photo';
import { CategorySheet, DiscardBevSheet } from './Sheets';
import { usePhotoUpload } from './usePhotoUpload';

/** Duplicate lookups wait this long after the last keystroke. */
export const DUPLICATES_DEBOUNCE_MS = 400;

type Step = 0 | 1 | 2;

/**
 * What a scan does to one field. `found` (what the product lists) goes in when the field is empty or
 * still holds what the last scan `wrote`. When the product lists nothing, the last scan's value is
 * cleared: it describes another product. Anything the person typed is left alone (`undefined`).
 */
function scanValue<T>(current: T, empty: boolean, wrote: T | undefined, found: T | null, blank: T): T | undefined {
  const fromLastScan = !empty && wrote !== undefined && current === wrote;
  if (found !== null) return empty || fromLastScan ? found : undefined;
  return fromLastScan ? blank : undefined;
}

const DETAIL_FIELDS = new Set(['name', 'brand', 'flavor', 'categoryId', 'priceTier']);

export interface CreateBevWizardProps {
  /** Prefill from search ("Add a new Bev" with what was typed). */
  initialName?: string;
}

/**
 * The create-Bev wizard (DEVELOPMENT-MATT §6.10): photo → details (+ optional label) → "Did you
 * mean…?" → create → the ranking flow. The photo uploads in the background as soon as it is
 * chosen; create waits (with backoff) while the server is still processing it.
 */
export function CreateBevWizard({ initialName = '' }: CreateBevWizardProps) {
  const router = useRouter();
  const back = useBack();
  const { colors } = useTheme();
  const online = useOnline();
  const me = useMe();
  const categoriesQ = useCategories();
  const createBev = useCreateBev();
  const photo = usePhotoUpload('bev-photo');
  const label = usePhotoUpload('label');
  const [nutrition, setNutrition] = useState<NutritionPreview | null>(null);
  // The label the last scan found, confirmed (then it is `nutrition` too) or still waiting.
  const [scanned, setScanned] = useState<NutritionPreview | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  // What the last scan wrote into the form. A field still holding it was not typed, so the next scan
  // replaces it: scanning the wrong can and then the right one must not mix the two products.
  const scanWrote = useRef<Partial<Pick<DetailsForm, ScanField>>>({});

  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<DetailsForm>({
    name: initialName,
    brand: '',
    flavor: '',
    categoryId: null,
    priceTier: null,
    priceEstimated: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [createdWithoutNutritionId, setCreatedWithoutNutritionId] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const existingQ = useBev(existingId ?? undefined);

  // Stop the processing wait if the wizard closes mid-create.
  const abort = useRef({ aborted: false });
  useEffect(() => {
    const a = abort.current;
    a.aborted = false; // StrictMode re-runs effects: re-arm after the simulated unmount.
    return () => {
      a.aborted = true;
    };
  }, []);

  const categories = useMemo(() => {
    const visible = visibleCategories(me.data?.canSeeAlcohol ?? false);
    const served = categoriesQ.data;
    return served ? visible.filter((c) => served.some((s) => s.id === c.id)) : visible;
  }, [me.data?.canSeeAlcohol, categoriesQ.data]);

  const lookup: FindDuplicatesInput = useMemo(
    () => ({
      name: form.name.trim(),
      ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
      ...(form.flavor.trim() ? { flavor: form.flavor.trim() } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    }),
    [form.name, form.brand, form.flavor, form.categoryId],
  );
  const debounced = useDebouncedValue(lookup, DUPLICATES_DEBOUNCE_MS);
  // Live while typing (debounced); on step 3 the form is settled, so look up exactly what was entered.
  // While typing, the last answer stays until the next one lands, so the hints it feeds don't flicker
  // and shift the fields (BEV-7). Step 3 keeps its honest "Checking Bevi…" instead of a stale answer.
  const duplicatesQ = useLikelyDuplicates(step === 2 ? lookup : debounced, {
    enabled: step >= 1,
    keepPrevious: step !== 2,
  });

  // Catch a wrong category at the source: the matches (from every category) mostly share another one.
  const categoryHint = useMemo(() => {
    const id = suggestCategory(duplicatesQ.data ?? [], form.categoryId, categories);
    return id ? categoryById(id) : null;
  }, [duplicatesQ.data, form.categoryId, categories]);

  const dirty =
    !!nutrition ||
    !!scanned ||
    !!photo.photo ||
    !!label.photo ||
    !!form.name.trim() ||
    !!form.brand.trim() ||
    !!form.flavor.trim() ||
    !!form.categoryId ||
    form.priceTier !== null ||
    form.priceEstimated;

  const leave = () => {
    abort.current.aborted = true;
    setConfirmDiscard(false);
    back();
  };
  // Discard closes its sheet first and leaves once that sheet is gone: popping the screen under a
  // Modal that is still presented leaves iOS with a stuck or blank screen (as in RankFlow).
  const discarding = useRef(false);
  const discard = () => {
    discarding.current = true;
    abort.current.aborted = true;
    setConfirmDiscard(false);
  };
  const discardClosed = () => {
    if (!discarding.current) return;
    discarding.current = false;
    leave();
  };
  const close = () => (dirty && !existingId ? setConfirmDiscard(true) : leave());

  const goRank = (bevId: string) => {
    abort.current.aborted = true;
    // Replace, so back from the ranking flow doesn't return to the wizard.
    router.replace({ pathname: '/rank/[bevId]', params: { bevId } });
  };

  const patch = (p: Partial<DetailsForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(p)) delete next[k as keyof FieldErrors];
      if ('priceEstimated' in p) delete next.priceTier;
      return next;
    });
    setSubmitMessage(null);
  };

  // A scan fills in what is still empty or what the last scan put there, and never replaces what was
  // typed. The name carried over from search counts as empty: it is what the person searched for,
  // not what they called the Bev. A category the person can't see (alcohol, under age) is not offered.
  const fillFromProduct = (product: BarcodeProduct) => {
    const wrote = scanWrote.current;
    const category = product.categoryId && categories.some((c) => c.id === product.categoryId) ? product.categoryId : null;
    const name = scanValue(form.name, !form.name.trim() || form.name === initialName, wrote.name, product.name, '');
    const brand = scanValue(form.brand, !form.brand.trim(), wrote.brand, product.brand, '');
    const categoryId = scanValue<CategoryId | null>(form.categoryId, !form.categoryId, wrote.categoryId, category, null);
    const change: Partial<Pick<DetailsForm, ScanField>> = {
      ...(name !== undefined ? { name } : {}),
      ...(brand !== undefined ? { brand } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
    };
    if (Object.keys(change).length > 0) patch(change);
    // Only what this scan put in; a field it cleared is the person's to fill again.
    const filled: Partial<Pick<DetailsForm, ScanField>> = {
      ...(name ? { name } : {}),
      ...(brand ? { brand } : {}),
      ...(categoryId ? { categoryId } : {}),
    };
    scanWrote.current = filled;
    const text = scanFilledText(Object.keys(filled) as ScanField[], !!product.nutrition);
    setScanNotice(text);
    // Once per scan, not whenever the line under the button changes (iOS; the web has its live region).
    announce(product.nutrition ? `${text} ${SCAN_CONFIRM_NUTRITION}` : text);
  };

  const pickPhoto = async (source: PhotoSource) => {
    setErrors((e) => ({ ...e, photo: undefined }));
    await photo.choose(source); // Cancelled: nothing changes, stay on the step.
  };
  const pickLabel = async (source: PhotoSource) => {
    setErrors((e) => ({ ...e, label: undefined }));
    await label.choose(source);
  };

  const validateDetails = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!form.name.trim()) e.name = FIELD_REQUIRED.name;
    if (!form.categoryId) e.categoryId = FIELD_REQUIRED.categoryId;
    if (form.priceTier === null && !form.priceEstimated) e.priceTier = FIELD_REQUIRED.priceTier;
    return e;
  };

  const next = () => {
    if (step === 0) {
      if (!photo.photo) {
        setErrors((e) => ({ ...e, photo: FIELD_REQUIRED.photo }));
        return;
      }
      setStep(1);
    } else if (step === 1) {
      const e = validateDetails();
      setErrors(e);
      if (Object.keys(e).length > 0) return;
      setSubmitMessage(null);
      setStep(2);
    }
  };

  const goBack = () => {
    if (existingId) {
      setExistingId(null);
      return;
    }
    if (step > 0) setStep((s) => (s - 1) as Step);
  };

  /** A failed upload (photo or label) during submit. */
  const onUploadError = (e: unknown, which: 'photo' | 'label') => {
    if (isUnsupportedImage(e) || (e instanceof Error && e.message === 'no_photo')) {
      // The image couldn't be read (or there's none): back to where it was chosen.
      setErrors((x) => ({ ...x, [which]: which === 'photo' && !isUnsupportedImage(e) ? FIELD_REQUIRED.photo : UNREADABLE_IMAGE }));
      setStep(which === 'photo' ? 0 : 1);
      return;
    }
    if (isApiError(e) && e.code === 'validation') {
      // Unsupported type or too large: the server's message says what to do.
      setErrors((x) => ({ ...x, [which]: e.message }));
      setStep(which === 'photo' ? 0 : 1);
      return;
    }
    setSubmitMessage(isApiError(e) && e.code === 'network' ? formErrorMessage(e) : UPLOAD_FAILED);
  };

  const onCreateError = (e: unknown) => {
    if (isAssetNotReady(e)) return setSubmitMessage(STILL_PROCESSING);
    if (!isApiError(e)) return setSubmitMessage(formErrorMessage(e));
    switch (e.code) {
      case 'conflict': {
        const id = (e.detail as { existingBevId?: string } | undefined)?.existingBevId;
        if (id) return setExistingId(id);
        return setSubmitMessage(formErrorMessage(e));
      }
      case 'validation': {
        const field = (e.detail as ValidationErrorDetail | undefined)?.field;
        if (field === 'nutrition') {
          setNutrition(null);
          setScanned(null);
          setErrors({ nutrition: 'Nutrition could not be saved. Scan the barcode again or continue without it.' });
          setStep(1);
          return;
        }
        if (field && DETAIL_FIELDS.has(field)) {
          setErrors({ [field]: e.message });
          return setStep(1);
        }
        if (field === 'photoAssetId') {
          photo.invalidate();
          return setSubmitMessage(PHOTO_REUPLOAD);
        }
        if (field === 'labelAssetId') {
          label.invalidate();
          setErrors({ label: LABEL_REUPLOAD });
          return setStep(1);
        }
        return setSubmitMessage(formErrorMessage(e));
      }
      case 'age_restricted':
        setErrors({ categoryId: CATEGORY_RESTRICTED });
        return setStep(1);
      default:
        // Offline, rate limited, unknown: the form is kept; Retry sends it again.
        return setSubmitMessage(formErrorMessage(e));
    }
  };

  const submit = async () => {
    if (!online || creating || !form.categoryId) return;
    setSubmitMessage(null);
    setCreating(true);
    try {
      let photoAssetId: string;
      try {
        photoAssetId = await photo.ensureUploaded();
      } catch (e) {
        return onUploadError(e, 'photo');
      }
      let labelAssetId: string | undefined;
      if (label.phase !== 'empty') {
        try {
          labelAssetId = await label.ensureUploaded();
        } catch (e) {
          return onUploadError(e, 'label');
        }
      }
      const input: CreateBevInput = {
        name: form.name.trim(),
        ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
        ...(form.flavor.trim() ? { flavor: form.flavor.trim() } : {}),
        categoryId: form.categoryId,
        priceTier: form.priceEstimated ? null : form.priceTier,
        priceEstimated: form.priceEstimated,
        photoAssetId,
        ...(labelAssetId ? { labelAssetId } : {}),
        ...(nutrition ? { nutrition } : {}),
      };
      try {
        const bev = await createWhenReady(createBev.mutateAsync, input, {
          onWaiting: () => setProcessing(true),
          signal: abort.current,
        });
        if (!abort.current.aborted) {
          if (nutrition && !bev.nutrition) {
            setCreatedWithoutNutritionId(bev.id);
            setSubmitMessage('Your Bev was added, but we couldn’t save its nutrition label. Continue without nutrition?');
          } else {
            goRank(bev.id);
          }
        }
      } catch (e) {
        if (!abort.current.aborted) onCreateError(e);
      }
    } finally {
      setCreating(false);
      setProcessing(false);
    }
  };

  const pickExisting = (bev: BevSummary) => goRank(bev.id);

  let body;
  if (existingId) {
    body = <ExistingBev bev={existingQ.data} onRank={() => goRank(existingId)} onEdit={() => {
          setExistingId(null);
          setStep(1);
        }} />;
  } else if (step === 0) {
    body = <PhotoStep slot={photo} onPick={(s) => void pickPhoto(s)} error={errors.photo} />;
  } else if (step === 1) {
    body = (
      <DetailsStep
        form={form}
        errors={errors}
        onChange={patch}
        onOpenCategories={() => setCategoryOpen(true)}
        label={label}
        nutrition={nutrition}
        onNutritionChange={(value) => { setNutrition(value); setErrors((e) => ({ ...e, nutrition: undefined })); }}
        scanned={scanned}
        onScannedChange={setScanned}
        onProduct={fillFromProduct}
        scanNotice={scanNotice}
        onPickLabel={(s) => void pickLabel(s)}
        similarCount={duplicatesQ.data?.length ?? 0}
        categoryHint={categoryHint}
        onUseCategory={(categoryId) => patch({ categoryId })}
      />
    );
  } else {
    body = (
      <DuplicatesStep
        duplicates={duplicatesQ.data}
        loading={duplicatesQ.isFetching && !duplicatesQ.data}
        checkFailed={duplicatesQ.isError}
        onRetryCheck={() => void duplicatesQ.refetch()}
        onPick={pickExisting}
        onCreate={() => createdWithoutNutritionId ? goRank(createdWithoutNutritionId) : void submit()}
        creating={creating}
        processing={processing}
        submitMessage={submitMessage}
        continueLabel={createdWithoutNutritionId ? 'Continue without nutrition' : undefined}
        blocked={!online}
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <Header
        title="New Bev"
        onBack={!createdWithoutNutritionId && (step > 0 || existingId) ? goBack : undefined}
        actions={createdWithoutNutritionId ? [] : [{ icon: 'x', label: 'Close', variant: 'filled', onPress: close }]}
      />
      <View style={styles.progress}>
        <View aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <ProgressDots total={STEP_COUNT} current={step} />
        </View>
        <Text style={[type.caption, { color: colors.textSecondary }]}>{`Step ${step + 1} of ${STEP_COUNT}`}</Text>
      </View>
      {!online ? (
        <View style={[styles.banner, { borderColor: colors.border }]} role="status" accessibilityLiveRegion="polite">
          <Icon name="wifi-off" size={18} strokeWidth={2} color={colors.textSecondary} />
          <Text style={[type.body, styles.flex, { color: colors.text }]}>{OFFLINE_BANNER}</Text>
        </View>
      ) : null}
      <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {step < 2 && !existingId ? (
          <Text style={[type.displayDrop, styles.heading, { color: colors.text }]} accessibilityRole="header">
            {STEP_TITLES[step]}
          </Text>
        ) : null}
        {body}
      </ScrollView>
      {step < 2 && !existingId ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button
            variant="primary"
            size="lg"
            block
            onPress={next}
            loading={step === 0 && photo.phase === 'preparing'}
            disabled={step === 0 && photo.phase === 'preparing'}
          >
            Next
          </Button>
        </View>
      ) : null}
      <CategorySheet
        open={categoryOpen}
        categories={categories}
        value={form.categoryId}
        onChoose={(categoryId) => {
          patch({ categoryId });
          setCategoryOpen(false);
        }}
        onClose={() => setCategoryOpen(false)}
      />
      <DiscardBevSheet open={confirmDiscard} onDiscard={discard} onKeep={() => setConfirmDiscard(false)} onClosed={discardClosed} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.gutter,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  flex: { flex: 1 },
  heading: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  content: { paddingBottom: spacing.xxl },
  footer: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.md, borderTopWidth: 1 },
});

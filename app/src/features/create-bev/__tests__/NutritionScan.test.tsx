import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError, type ApiErrorCode, type NutritionPreview } from '@bevi/shared';
import { api } from '@/api/client';
import { useOnline } from '@/lib/useOnline';
import { NutritionScan } from '../NutritionScan';
import type { PhotoUpload } from '../usePhotoUpload';

jest.mock('../BarcodeCamera', () => ({ BarcodeCamera: () => null }));
jest.mock('@/lib/useOnline', () => ({ useOnline: jest.fn(() => true) }));
jest.mock('@/components/Sheet', () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
const preview: NutritionPreview = {
  barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
  calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
  sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901', source: 'openfoodfacts',
};
async function enterBarcode() {
  await fireEvent.press(screen.getByLabelText('Scan barcode for nutrition'));
  await fireEvent.changeText(screen.getByLabelText('Or enter barcode digits'), preview.barcode!);
  await fireEvent.press(screen.getByLabelText('Look up entered barcode'));
}
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); jest.mocked(useOnline).mockReturnValue(true); });
it('shows nutrition for two seconds plus fades, then keeps a readable preview', async () => {
  jest.useFakeTimers();
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(preview);
  await render(<NutritionScan />);
  await enterBarcode();
  expect(screen.getAllByText('Test water')).toHaveLength(2);
  expect(screen.getByLabelText('Close barcode scanner')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(2499); });
  expect(screen.getByLabelText('Close barcode scanner')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(screen.queryByLabelText('Close barcode scanner')).toBeNull();
  expect(screen.getByText('Test water')).toBeTruthy();
  expect(screen.getByLabelText('0 calories')).toBeTruthy();
});
it('explains a missing product without claiming it captured nutrition', async () => {
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(null);
  await render(<NutritionScan />);
  await enterBarcode();
  expect(screen.getByText(/Nutrition information unavailable/)).toBeTruthy();
  expect(screen.queryByText('Nutrition Facts')).toBeNull();
});
it('aborts on close and ignores a late lookup result', async () => {
  let finish!: (value: NutritionPreview) => void;
  const lookup = jest.spyOn(api.nutrition!, 'lookupBarcode').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<NutritionScan />);
  await enterBarcode();
  const signal = lookup.mock.calls[0]![1]!;
  await fireEvent.press(screen.getByLabelText('Close barcode scanner'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(preview));
  expect(screen.queryByText('Test water')).toBeNull();
});

it('requires confirmation before attaching a scanned product to the new Bev', async () => {
  jest.useFakeTimers();
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(preview);
  const onChange = jest.fn();
  await render(<NutritionScan value={null} onChange={onChange} />);
  await enterBarcode();
  expect(onChange).not.toHaveBeenCalledWith(preview);
  await act(async () => { jest.advanceTimersByTime(2500); });
  await fireEvent.press(screen.getByLabelText('Use this nutrition label'));
  expect(onChange).toHaveBeenLastCalledWith(preview);
  await fireEvent.press(screen.getByLabelText('Remove scanned nutrition'));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('hides the scanner entirely when the API has no nutrition capability', async () => {
  const { nutrition } = api;
  delete api.nutrition;
  try {
    await render(<NutritionScan value={null} onChange={jest.fn()} />);
    expect(screen.queryByLabelText('Scan barcode for nutrition')).toBeNull();
    expect(screen.queryByText(/Scan the barcode or upload a photo/)).toBeNull();
  } finally {
    api.nutrition = nutrition;
  }
});

// --- Nutrition read from a photo of the label (BEV-13) ---

const labelRead: NutritionPreview = {
  barcode: null, productName: 'Mountain Dew', basis: 'Per serving (12 fl oz (355 mL))',
  calories: 170, fatGrams: 0, carbohydrateGrams: 46, sugarGrams: 46, proteinGrams: null,
  sodiumMg: 60, sourceUrl: null, source: 'label-ocr',
};
function labelSlot(overrides: Partial<PhotoUpload> = {}, uri = 'blob:label-1'): PhotoUpload {
  return {
    phase: 'uploaded', error: null,
    photo: { uri, blob: new Blob(['x']), mimeType: 'image/jpeg', width: 1, height: 1 },
    asset: { assetId: 'label-asset', status: 'ready' },
    choose: jest.fn(), retry: jest.fn(), clear: jest.fn(), invalidate: jest.fn(),
    ensureUploaded: jest.fn().mockResolvedValue('label-asset'),
    ...overrides,
  } as unknown as PhotoUpload;
}
const READ = 'Read nutrition from the label photo';
const readButton = () => screen.getAllByLabelText(READ)[0]!;

it('reveals a label read with the same fade, then asks for confirmation that says it was read from the photo', async () => {
  jest.useFakeTimers();
  const scan = jest.spyOn(api.nutrition!, 'scanLabel').mockResolvedValue(labelRead);
  const onChange = jest.fn();
  await render(<NutritionScan value={null} onChange={onChange} label={labelSlot()} onPickLabel={jest.fn()} />);
  await fireEvent.press(readButton());
  expect(scan).toHaveBeenCalledWith('label-asset', expect.any(AbortSignal));
  expect(screen.getAllByText('Mountain Dew')).toHaveLength(2);
  expect(screen.getByText('Captured')).toBeTruthy();
  expect(screen.getByLabelText('Close label reader')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalledWith(labelRead);
  await act(async () => { jest.advanceTimersByTime(2499); });
  expect(screen.getByLabelText('Close label reader')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(screen.queryByLabelText('Close label reader')).toBeNull();
  // The inline preview: a read, not a barcode match, with no third-party credit.
  expect(screen.getByText('Read from your label')).toBeTruthy();
  expect(screen.queryByText('Barcode match')).toBeNull();
  expect(screen.queryByLabelText('View product on Open Food Facts')).toBeNull();
  expect(screen.getByText(/read from your photo\. Check them against the package/)).toBeTruthy();
  expect(onChange).not.toHaveBeenCalledWith(labelRead);
  await fireEvent.press(screen.getByLabelText('Use this nutrition label'));
  expect(onChange).toHaveBeenLastCalledWith(labelRead);
  await fireEvent.press(screen.getByLabelText('Remove scanned nutrition'));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('keeps the barcode caption and the Open Food Facts credit for a barcode match', async () => {
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(preview);
  await render(<NutritionScan value={null} onChange={jest.fn()} label={labelSlot()} onPickLabel={jest.fn()} />);
  await enterBarcode();
  expect(screen.getAllByLabelText('View product on Open Food Facts').length).toBeGreaterThan(0);
  expect(screen.getByText('Captured')).toBeTruthy(); // during the reveal; 'Barcode match' once it settles
});

it('offers the label photo picker inside the sheet, for someone whose barcode found nothing', async () => {
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(null);
  const onPickLabel = jest.fn();
  await render(<NutritionScan value={null} onChange={jest.fn()} label={labelSlot({ phase: 'empty', photo: null, asset: null })} onPickLabel={onPickLabel} />);
  await enterBarcode();
  expect(screen.getByText(/Nutrition information unavailable/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Take a photo of the label'));
  expect(onPickLabel).toHaveBeenLastCalledWith('camera');
  await fireEvent.press(screen.getByLabelText('Choose a photo of the label'));
  expect(onPickLabel).toHaveBeenLastCalledWith('library');
  // Nothing to read until a photo exists.
  expect(screen.queryByLabelText(READ)).toBeNull();
});

describe.each<[string, () => Promise<NutritionPreview | null>, RegExp]>([
  ['no panel found', async () => null, /No nutrition panel found in that photo/],
  ['rate limited', async () => { throw new ApiError('rate_limited', 'Too many label reads. Try again in an hour.'); }, /Too many label reads/],
  ['offline', async () => { throw new ApiError('network', 'x'); }, /You're offline/],
  ['not deployed yet', async () => { throw new ApiError('unknown', 'x'); }, /isn't available yet/],
  ['a photo the reader rejected', async () => { throw new ApiError('validation', 'x', { field: 'labelAssetId' }); }, /couldn't use that photo/],
] as [string, () => Promise<NutritionPreview | null>, RegExp][])('a label read that fails: %s', (_name, reader, copy) => {
  it('says so, attaches nothing and can be tried again', async () => {
    jest.spyOn(api.nutrition!, 'scanLabel').mockImplementation(reader);
    const onChange = jest.fn();
    const slot = labelSlot();
    await render(<NutritionScan value={null} onChange={onChange} label={slot} onPickLabel={jest.fn()} />);
    await fireEvent.press(readButton());
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText('Nutrition Facts')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    if (_name === 'a photo the reader rejected') expect(slot.invalidate).toHaveBeenCalled();
    expect(screen.getAllByLabelText(READ).at(-1)).toBeEnabled();
  });
});

it('does not try a label read while offline, and says why', async () => {
  jest.mocked(useOnline).mockReturnValue(false);
  const scan = jest.spyOn(api.nutrition!, 'scanLabel');
  await render(<NutritionScan value={null} onChange={jest.fn()} label={labelSlot()} onPickLabel={jest.fn()} />);
  expect(screen.getByText(/You're offline/)).toBeTruthy();
  await fireEvent.press(readButton());
  expect(scan).not.toHaveBeenCalled();
});

it('reports a label photo that failed to upload instead of reading it', async () => {
  const scan = jest.spyOn(api.nutrition!, 'scanLabel');
  const slot = labelSlot({ ensureUploaded: jest.fn().mockRejectedValue(new ApiError('network', 'x')) });
  await render(<NutritionScan value={null} onChange={jest.fn()} label={slot} onPickLabel={jest.fn()} />);
  await fireEvent.press(readButton());
  expect(await screen.findByText(/You're offline/)).toBeTruthy();
  expect(scan).not.toHaveBeenCalled();
});

it('drops a label read when its photo is replaced or removed, since it no longer matches', async () => {
  jest.useFakeTimers();
  jest.spyOn(api.nutrition!, 'scanLabel').mockResolvedValue(labelRead);
  const onChange = jest.fn();
  const first = labelSlot();
  const view = await render(<NutritionScan value={null} onChange={onChange} label={first} onPickLabel={jest.fn()} />);
  await fireEvent.press(readButton());
  await act(async () => { jest.advanceTimersByTime(2500); });
  expect(screen.getByText('Mountain Dew')).toBeTruthy();
  onChange.mockClear();
  await view.rerender(<NutritionScan value={null} onChange={onChange} label={labelSlot({}, 'blob:label-2')} onPickLabel={jest.fn()} />);
  expect(screen.queryByText('Mountain Dew')).toBeNull();
  expect(onChange).toHaveBeenCalledWith(null);
});

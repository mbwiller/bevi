import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { NutritionPreview } from '@bevi/shared';
import { api } from '@/api/client';
import { NutritionScan } from '../NutritionScan';
import { VISION_FIXTURES } from '../__fixtures__/visionFixtures';
import { recogniseText } from '../textRecognition';
import type { PhotoUpload } from '../usePhotoUpload';

jest.mock('../BarcodeCamera', () => ({ BarcodeCamera: () => null }));
// The native recogniser cannot run under jest: stand in for it. `available` is what the web file reports as false.
jest.mock('../textRecognition', () => ({
  TEXT_RECOGNITION_AVAILABLE: true,
  recogniseText: jest.fn(),
}));
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
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); jest.mocked(recogniseText).mockReset(); });
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

// --- Nutrition read from a photo of the label, on the device (BEV-13) ---

const lines = VISION_FIXTURES['bai-kula-watermelon']!;
function labelSlot(overrides: Partial<PhotoUpload> = {}, uri = 'file:///label-1.jpg'): PhotoUpload {
  return {
    phase: 'uploading', error: null,
    photo: { uri, blob: new Blob(['x']), mimeType: 'image/jpeg', width: 1, height: 1 },
    asset: null,
    choose: jest.fn(), retry: jest.fn(), clear: jest.fn(), invalidate: jest.fn(),
    ensureUploaded: jest.fn().mockResolvedValue('label-asset'),
    ...overrides,
  } as unknown as PhotoUpload;
}
const READ = 'Read nutrition from the label photo';
const readButton = () => screen.getAllByLabelText(READ)[0]!;

it('reads the local photo, never the upload, and reveals with the same fade before asking for confirmation', async () => {
  jest.useFakeTimers();
  jest.mocked(recogniseText).mockResolvedValue(lines);
  const lookup = jest.spyOn(api.nutrition!, 'lookupBarcode');
  const slot = labelSlot();
  const onChange = jest.fn();
  await render(<NutritionScan value={null} onChange={onChange} label={slot} onPickLabel={jest.fn()} draftName="  Kula Watermelon " />);
  await fireEvent.press(readButton());
  // The photo is still uploading, and the read did not wait for it or touch it.
  expect(recogniseText).toHaveBeenCalledWith('file:///label-1.jpg');
  expect(slot.ensureUploaded).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
  expect(screen.getAllByText('Kula Watermelon')).toHaveLength(2);
  expect(screen.getByText('Captured')).toBeTruthy();
  expect(screen.getByLabelText('Close label reader')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'label-ocr' }));
  await act(async () => { jest.advanceTimersByTime(2499); });
  expect(screen.getByLabelText('Close label reader')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(screen.queryByLabelText('Close label reader')).toBeNull();
  expect(screen.getByText('Read from your label')).toBeTruthy();
  expect(screen.queryByText('Barcode match')).toBeNull();
  expect(screen.queryByLabelText('View product on Open Food Facts')).toBeNull();
  expect(screen.getByText(/read from your photo\. Check them against the package/)).toBeTruthy();
  expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'label-ocr' }));
  await fireEvent.press(screen.getByLabelText('Use this nutrition label'));
  const used = onChange.mock.calls.at(-1)![0] as NutritionPreview;
  expect(used).toMatchObject({ source: 'label-ocr', barcode: null, sourceUrl: null, productName: 'Kula Watermelon' });
  expect(used.calories).toEqual(expect.any(Number));
  await fireEvent.press(screen.getByLabelText('Remove scanned nutrition'));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('files a read under "Scanned label" when no name has been typed', async () => {
  jest.useFakeTimers();
  jest.mocked(recogniseText).mockResolvedValue(lines);
  const onChange = jest.fn();
  await render(<NutritionScan value={null} onChange={onChange} label={labelSlot()} onPickLabel={jest.fn()} draftName="  " />);
  await fireEvent.press(readButton());
  await act(async () => { jest.advanceTimersByTime(2500); });
  await fireEvent.press(screen.getByLabelText('Use this nutrition label'));
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ productName: 'Scanned label' });
});

it('keeps the barcode caption and the Open Food Facts credit for a barcode match', async () => {
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(preview);
  await render(<NutritionScan value={null} onChange={jest.fn()} label={labelSlot()} onPickLabel={jest.fn()} />);
  await enterBarcode();
  expect(screen.getAllByLabelText('View product on Open Food Facts').length).toBeGreaterThan(0);
  expect(screen.getByText('Captured')).toBeTruthy();
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
  expect(screen.queryByLabelText(READ)).toBeNull();
});

describe.each<[string, () => Promise<unknown>, RegExp]>([
  ['no panel found in the photo', async () => [{ text: 'Mountain Dew', confidence: 1, x: 0.1, y: 0.9 }], /Couldn't find a Nutrition Facts panel in that photo/],
  ['the recogniser could not use the image', async () => { throw new Error('unreadable image'); }, /Couldn't read that photo\. Take it again in good light/],
])('a label read that fails: %s', (_name, recognise, copy) => {
  it('says so, attaches nothing and can be tried again', async () => {
    jest.mocked(recogniseText).mockImplementation(recognise as never);
    const onChange = jest.fn();
    await render(<NutritionScan value={null} onChange={onChange} label={labelSlot()} onPickLabel={jest.fn()} />);
    await fireEvent.press(readButton());
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText('Nutrition Facts')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText(READ).at(-1)).toBeEnabled();
  });
});

it('reads a photo whose upload has failed: that is a separate problem, shown by the photo slot', async () => {
  jest.useFakeTimers();
  jest.mocked(recogniseText).mockResolvedValue(lines);
  const slot = labelSlot({ phase: 'failed', error: new Error('x'), ensureUploaded: jest.fn().mockRejectedValue(new Error('x')) });
  await render(<NutritionScan value={null} onChange={jest.fn()} label={slot} onPickLabel={jest.fn()} />);
  await fireEvent.press(readButton());
  expect(screen.getByText('Captured')).toBeTruthy();
  expect(slot.ensureUploaded).not.toHaveBeenCalled();
});

it('drops a label read when its photo is replaced or removed, since it no longer matches', async () => {
  jest.useFakeTimers();
  jest.mocked(recogniseText).mockResolvedValue(lines);
  const onChange = jest.fn();
  const view = await render(<NutritionScan value={null} onChange={onChange} label={labelSlot()} onPickLabel={jest.fn()} draftName="Kula" />);
  await fireEvent.press(readButton());
  await act(async () => { jest.advanceTimersByTime(2500); });
  expect(screen.getByText('Kula')).toBeTruthy();
  onChange.mockClear();
  await view.rerender(<NutritionScan value={null} onChange={onChange} label={labelSlot({}, 'file:///label-2.jpg')} onPickLabel={jest.fn()} draftName="Kula" />);
  expect(screen.queryByText('Kula')).toBeNull();
  expect(onChange).toHaveBeenCalledWith(null);
});

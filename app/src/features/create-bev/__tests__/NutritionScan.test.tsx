import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { BarcodeProduct, NutritionPreview } from '@bevi/shared';
import { api } from '@/api/client';
import { NutritionScan } from '../NutritionScan';

jest.mock('../BarcodeCamera', () => ({ BarcodeCamera: () => null }));
jest.mock('@/components/Sheet', () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
const preview: NutritionPreview = {
  barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
  calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
  sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901',
};
const product: BarcodeProduct = { barcode: preview.barcode, name: 'Test water', brand: 'Nowhere Co', categoryId: 'water', nutrition: preview };
async function enterBarcode() {
  await fireEvent.press(screen.getByLabelText('Scan barcode for nutrition'));
  await fireEvent.changeText(screen.getByLabelText('Or enter barcode digits'), preview.barcode);
  await fireEvent.press(screen.getByLabelText('Look up entered barcode'));
}
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
it('shows nutrition for two seconds plus fades, then keeps a readable preview', async () => {
  jest.useFakeTimers();
  jest.spyOn(api.nutrition!, 'lookupProduct').mockResolvedValue(product);
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
  jest.spyOn(api.nutrition!, 'lookupProduct').mockResolvedValue(null);
  await render(<NutritionScan />);
  await enterBarcode();
  expect(screen.getByText(/Nutrition information unavailable/)).toBeTruthy();
  expect(screen.queryByText('Nutrition Facts')).toBeNull();
});
it('aborts on close and ignores a late lookup result', async () => {
  let finish!: (value: BarcodeProduct) => void;
  const lookup = jest.spyOn(api.nutrition!, 'lookupProduct').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<NutritionScan />);
  await enterBarcode();
  const signal = lookup.mock.calls[0]![1]!;
  await fireEvent.press(screen.getByLabelText('Close barcode scanner'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(product));
  expect(screen.queryByText('Test water')).toBeNull();
});

it('requires confirmation before attaching a scanned product to the new Bev', async () => {
  jest.useFakeTimers();
  jest.spyOn(api.nutrition!, 'lookupProduct').mockResolvedValue(product);
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

it('without a wizard to fill in, a product that lists no nutrition reads as unavailable', async () => {
  jest.spyOn(api.nutrition!, 'lookupProduct').mockResolvedValue({ ...product, nutrition: null });
  await render(<NutritionScan />);
  await enterBarcode();
  expect(screen.getByText(/Nutrition information unavailable/)).toBeTruthy();
  expect(screen.getByLabelText('Close barcode scanner')).toBeTruthy();
  expect(screen.queryByText('Nutrition Facts')).toBeNull();
});

it('hands the wizard the product it found, and nothing when the lookup was closed first', async () => {
  let finish!: (value: BarcodeProduct) => void;
  jest.spyOn(api.nutrition!, 'lookupProduct').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onProduct = jest.fn();
  await render(<NutritionScan value={null} onChange={jest.fn()} onProduct={onProduct} />);
  await enterBarcode();
  await act(async () => finish(product));
  expect(onProduct).toHaveBeenCalledTimes(1);
  expect(onProduct).toHaveBeenCalledWith(product);

  await fireEvent.press(screen.getByLabelText('Close barcode scanner'));
  await enterBarcode();
  await fireEvent.press(screen.getByLabelText('Close barcode scanner'));
  await act(async () => finish({ ...product, name: 'Late water' }));
  expect(onProduct).toHaveBeenCalledTimes(1);
});

it('shows a product the wizard refuses as a barcode Bevi does not know, and offers no label', async () => {
  jest.spyOn(api.nutrition!, 'lookupProduct').mockResolvedValue(product);
  const onProduct = jest.fn(() => false);
  const onChange = jest.fn();
  await render(<NutritionScan value={null} onChange={onChange} onProduct={onProduct} />);
  await enterBarcode();
  expect(onProduct).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Bevi doesn't know that barcode. Try another, or close this and enter the details yourself.")).toBeTruthy();
  expect(screen.getByLabelText('Close barcode scanner')).toBeTruthy();
  expect(screen.queryByText('Nutrition Facts')).toBeNull();
  expect(screen.queryByLabelText('Use this nutrition label')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
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

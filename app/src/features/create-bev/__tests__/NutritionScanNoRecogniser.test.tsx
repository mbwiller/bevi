import { fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '@/api/client';
import { NutritionScan } from '../NutritionScan';
import type { PhotoUpload } from '../usePhotoUpload';

// Where there is no text recogniser (the web build), the label read must not be offered at all.
jest.mock('../BarcodeCamera', () => ({ BarcodeCamera: () => null }));
jest.mock('../textRecognition', () => ({ TEXT_RECOGNITION_AVAILABLE: false, recogniseText: jest.fn() }));
jest.mock('@/components/Sheet', () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));

const slot = {
  phase: 'uploaded', error: null,
  photo: { uri: 'blob:label', blob: new Blob(['x']), mimeType: 'image/jpeg', width: 1, height: 1 },
  asset: { assetId: 'label-asset', status: 'ready' },
  choose: jest.fn(), retry: jest.fn(), clear: jest.fn(), invalidate: jest.fn(), ensureUploaded: jest.fn(),
} as unknown as PhotoUpload;

afterEach(() => jest.restoreAllMocks());

it('keeps the barcode route and the plain label upload, and shows no button that cannot work', async () => {
  jest.spyOn(api.nutrition!, 'lookupBarcode').mockResolvedValue(null);
  await render(<NutritionScan value={null} onChange={jest.fn()} label={slot} onPickLabel={jest.fn()} />);
  expect(screen.getByLabelText('Scan barcode for nutrition')).toBeTruthy();
  expect(screen.queryByLabelText('Read nutrition from the label photo')).toBeNull();
  expect(screen.getByText('Scan the barcode or upload a photo of the label.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Scan barcode for nutrition'));
  await fireEvent.changeText(screen.getByLabelText('Or enter barcode digits'), '012345678901');
  await fireEvent.press(screen.getByLabelText('Look up entered barcode'));
  expect(await screen.findByText(/Nutrition information unavailable/)).toBeTruthy();
  expect(screen.queryByLabelText('Take a photo of the label')).toBeNull();
  expect(screen.queryByLabelText('Read nutrition from the label photo')).toBeNull();
});

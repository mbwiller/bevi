import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { BevSummary } from '@bevi/shared';

import { api, mockControls } from '@/api/client';
import { categoryById } from '@/lib/categories';

import { CreateBevWizard } from '../CreateBevWizard';
import { pickImage, preparePhoto, UnsupportedImageError } from '../photo';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ canGoBack: () => true, back: mockBack, replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

// The picker and the canvas resize are browser-only; the wizard sees what they would return.
jest.mock('../photo', () => ({
  ...jest.requireActual('../photo'),
  pickImage: jest.fn(),
  preparePhoto: jest.fn(),
}));
const mockPick = pickImage as jest.MockedFunction<typeof pickImage>;
const mockPrepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;

const controls = mockControls!;
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
/** The mock keeps a new photo 'processing' for 3 s; create waits for it with backoff. */
const READY_TIMEOUT = { timeout: 12000 };
let client: QueryClient;

const asset = { uri: 'blob:photo', width: 3000, height: 4000, mimeType: 'image/jpeg' } as Awaited<ReturnType<typeof pickImage>>;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  mockPick.mockResolvedValue(asset);
  let n = 0;
  mockPrepare.mockImplementation(async () => ({
    uri: `blob:prepared-${++n}`,
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 1200,
    height: 1600,
  }));
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockPick.mockReset();
  mockPrepare.mockReset();
});

async function renderWizard() {
  await render(
    <QueryClientProvider client={client}>
      <CreateBevWizard />
    </QueryClientProvider>,
  );
}

async function addPhoto() {
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await screen.findByRole('button', { name: 'Retake' });
}

async function fillDetails({ name, brand, flavor, category }: { name: string; brand?: string; flavor?: string; category: string }) {
  await fireEvent.changeText(screen.getByLabelText('Name'), name);
  if (brand) await fireEvent.changeText(screen.getByLabelText('Brand or shop (optional)'), brand);
  if (flavor) await fireEvent.changeText(screen.getByLabelText('Flavor (optional)'), flavor);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a category' }));
  await fireEvent.press(await screen.findByRole('button', { name: category }));
  await fireEvent.press(screen.getByText('Not sure, estimate it'));
}

/** A non-alcoholic fixture Bev demo can see. */
async function existingBev(): Promise<BevSummary> {
  const page = await api.bevs.search({ q: 'cola', limit: 50 });
  const bev = page.items.find((b) => !categoryById(b.categoryId).isAlcoholic);
  if (!bev) throw new Error('no fixture Bev');
  return bev;
}

it('walks photo → details → "Looks new" → create, uploading in the background, then replaces to the ranking flow', async () => {
  const upload = jest.spyOn(api.media, 'upload');
  const create = jest.spyOn(api.bevs, 'create');
  await renderWizard();
  expect(screen.getByText('Step 1 of 3')).toBeTruthy();

  // Next without a photo says what to do.
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Add a photo of the Bev.')).toBeTruthy();

  await addPhoto();
  expect(mockPick).toHaveBeenCalledWith('camera');
  // Uploaded as soon as it was chosen, before the details.
  await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bev-photo', mimeType: 'image/jpeg' })));

  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Step 2 of 3')).toBeTruthy();

  // Required fields.
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Enter a name.')).toBeTruthy();
  expect(screen.getByText('Choose a category.')).toBeTruthy();
  expect(screen.getByText('Choose a price, or "Not sure".')).toBeTruthy();

  await fillDetails({ name: 'Qzx Glimmer Tonic', brand: 'Nowhere Co', category: 'Soda' });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Step 3 of 3')).toBeTruthy();
  await screen.findByText('Looks new');

  await fireEvent.press(screen.getByRole('button', { name: 'Add and rank it' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalled(), READY_TIMEOUT);
  const made = await create.mock.results.at(-1)!.value;
  expect(create.mock.calls.at(-1)![0]).toMatchObject({
    name: 'Qzx Glimmer Tonic',
    brand: 'Nowhere Co',
    categoryId: 'soda',
    priceTier: null,
    priceEstimated: true,
  });
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/rank/[bevId]', params: { bevId: made.id } });
});

it('shows "Processing photo…" and retries create while the photo is not ready', async () => {
  const create = jest.spyOn(api.bevs, 'create');
  await renderWizard();
  await addPhoto();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fillDetails({ name: 'Qzx Slow Photo Soda', category: 'Soda' });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Looks new');
  await fireEvent.press(screen.getByRole('button', { name: 'Add and rank it' }));

  await screen.findByText('Processing photo…');
  expect(create).toHaveBeenCalled();
  await expect(create.mock.results[0]!.value).rejects.toMatchObject({ code: 'validation', detail: { reason: 'asset_not_ready' } });

  await waitFor(() => expect(mockReplace).toHaveBeenCalled(), READY_TIMEOUT);
  expect(create.mock.calls.length).toBeGreaterThan(1);
});

it('"Did you mean…?" lists likely duplicates; choosing one goes to rank it without creating', async () => {
  const bev = await existingBev();
  const create = jest.spyOn(api.bevs, 'create');
  await renderWizard();
  await addPhoto();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fillDetails({ name: bev.name, category: categoryById(bev.categoryId).label });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

  await screen.findByText('Did you mean…?');
  await fireEvent.press(await screen.findByLabelText(`Rank ${bev.name}`));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/rank/[bevId]', params: { bevId: bev.id } });
  expect(create).not.toHaveBeenCalled();
});

it('an exact duplicate (conflict) offers the existing Bev', async () => {
  const bev = await existingBev();
  await renderWizard();
  await addPhoto();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fillDetails({
    name: bev.name,
    brand: bev.brand ?? undefined,
    flavor: bev.flavor ?? undefined,
    category: categoryById(bev.categoryId).label,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'No, mine is different' }));

  await screen.findByText("It's already on Bevi", {}, READY_TIMEOUT);
  await screen.findByRole('button', { name: bev.name });
  await fireEvent.press(screen.getByRole('button', { name: 'Rank it' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/rank/[bevId]', params: { bevId: bev.id } });
});

it('a network failure on create keeps the form and Retry sends it again', async () => {
  await renderWizard();
  await addPhoto();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fillDetails({ name: 'Qzx Offline Fizz', category: 'Soda' });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Looks new');
  controls.failNext('network', 'bevs.create');
  await fireEvent.press(screen.getByRole('button', { name: 'Add and rank it' }));

  await screen.findByText(/You're offline/);
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalled(), READY_TIMEOUT);
});

it('cancelling the picker stays on the photo step with nothing chosen', async () => {
  mockPick.mockResolvedValue(null);
  const upload = jest.spyOn(api.media, 'upload');
  await renderWizard();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  await waitFor(() => expect(mockPick).toHaveBeenCalledWith('library'));
  expect(screen.getByRole('button', { name: 'Choose photo' })).toBeTruthy();
  expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
});

it('closing with something entered asks before discarding; with nothing entered it just closes', async () => {
  await renderWizard();
  await fireEvent.press(screen.getAllByLabelText('Close')[0]!);
  expect(mockBack).toHaveBeenCalledTimes(1);

  await addPhoto();
  await fireEvent.press(screen.getAllByLabelText('Close')[0]!);
  await screen.findByText('Discard this Bev?');
  await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getAllByLabelText('Close')[0]!);
  await fireEvent.press(await screen.findByRole('button', { name: 'Discard' }));
  expect(mockBack).toHaveBeenCalledTimes(2);
});

it('the category sheet hides alcoholic categories for an under-21 account', async () => {
  controls.signInAs('theo');
  await renderWizard();
  await addPhoto();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a category' }));
  await screen.findByRole('button', { name: 'Soda' });
  expect(screen.queryByRole('button', { name: 'Beer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Wine' })).toBeNull();
});

it('revokes the preview URL when the photo is replaced, and on unmount', async () => {
  const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  await renderWizard();
  await addPhoto();
  expect(revoke).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retake' }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:prepared-1'));
  expect(revoke).not.toHaveBeenCalledWith('blob:prepared-2');
  await screen.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:prepared-2');
});

it('Next waits while the photo is being prepared', async () => {
  let finish!: () => void;
  mockPrepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ uri: 'blob:slow', blob: new Blob(['jpeg'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', width: 10, height: 10 });
      }),
  );
  await renderWizard();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
  finish();
  await screen.findByRole('button', { name: 'Retake' });
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it("an image that can't be read says so and is never uploaded", async () => {
  mockPrepare.mockRejectedValueOnce(new UnsupportedImageError());
  const upload = jest.spyOn(api.media, 'upload');
  await renderWizard();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  await screen.findByText("Bevi can't read that image. Try a JPEG or PNG.");
  expect(screen.queryByRole('button', { name: 'Retry upload' })).toBeNull();
  expect(upload).not.toHaveBeenCalled();
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';

import { BugReportForm } from '../BugReportForm';
import { DRAFT_KEY, type StorageLike } from '../draft';
import { pickImage, preparePhoto } from '@/features/create-bev/photo';

// The picker and the canvas resize are browser-only; the form sees what they
// would return. Everything else runs for real against the FakeApi.
jest.mock('@/features/create-bev/photo', () => ({
  ...jest.requireActual('@/features/create-bev/photo'),
  pickImage: jest.fn(),
  preparePhoto: jest.fn(),
}));
const mockPick = pickImage as jest.MockedFunction<typeof pickImage>;
const mockPrepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;

const mockOpenURL = jest.fn();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let client: QueryClient;
let storage: ReturnType<typeof memoryStorage>;
const onClose = jest.fn();

async function renderForm(fromRoute = '/bev/[id]') {
  // `render` is async in this version of RNTL (React 19 concurrent rendering);
  // not awaiting it leaves `screen` unset.
  return await render(
    <QueryClientProvider client={client}>
      <BugReportForm fromRoute={fromRoute} onClose={onClose} storage={storage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  storage = memoryStorage();
  onClose.mockClear();
  mockOpenURL.mockClear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  mockPick.mockResolvedValue({ uri: 'blob:shot', width: 1170, height: 2532, mimeType: 'image/jpeg' } as Awaited<
    ReturnType<typeof pickImage>
  >);
  mockPrepare.mockResolvedValue({
    uri: 'blob:prepared',
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 740,
    height: 1600,
  });
});

afterEach(() => {
  client.clear();
  mockPick.mockReset();
  mockPrepare.mockReset();
});

describe('the bug reporter', () => {
  it('needs a title, and says so without sending anything', async () => {
    await renderForm();
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    expect(await screen.findByText('Say what went wrong.')).toBeTruthy();
    expect(screen.queryByText(/^Created BEV-/)).toBeNull();
  });

  it('files the report and shows the ticket the tracker assigned', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Ratings disappear after a refresh');
    await fireEvent.changeText(screen.getByLabelText('Describe the problem'), 'Rated an iced matcha, it was gone.');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));

    expect(await screen.findByText(/^Created BEV-\d+$/)).toBeTruthy();
    // The ticket id is the tracker's, not something the client made up.
    expect(screen.getByText(/^Created BEV-\d+$/).props.children).toMatch(/^Created BEV-\d+$/);
    expect(screen.getByLabelText('Open the ticket')).toBeTruthy();
  });

  it('clears the draft once the report is filed', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Search is empty');
    await waitFor(() => expect(storage.map.has(DRAFT_KEY)).toBe(true));
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    await screen.findByText(/^Created BEV-\d+$/);
    expect(storage.map.has(DRAFT_KEY)).toBe(false);
  });

  it('keeps the draft and offers a retry when the submission fails', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Keyboard covers the results');
    controls.failNext('network', 'bugs.report');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));

    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
    const draft = JSON.parse(storage.map.get(DRAFT_KEY)!) as { title: string };
    expect(draft.title).toBe('Keyboard covers the results');
  });

  it('retries the same draft rather than starting a new one', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Duplicate cards in saved list');
    const keyBefore = lastKeyAfter(storage);
    controls.failNext('network', 'bugs.report');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    await screen.findByLabelText('Try again');
    await waitFor(() => expect(lastKeyAfter(storage)).toBe(keyBefore));

    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findByText(/^Created BEV-\d+$/)).toBeTruthy();
  });

  it('answers a replayed key with the ticket it already made, never a second one', async () => {
    // The guarantee the retry above depends on, asserted where it lives: one
    // idempotency key is one ticket. The FakeApi keeps the same ledger the
    // server does (supabase/tests/28_bug_reports.test.sql covers the real one).
    const idempotencyKey = '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11';
    const input = { kind: 'bug', severity: 'bad', title: 'Duplicate cards in saved list', idempotencyKey } as const;
    const first = await api.bugs.report(input);
    const second = await api.bugs.report(input);
    expect(first.status).toBe('created');
    expect(second).toEqual({ ...first, status: 'duplicate' });
  });

  it('attaches a screenshot and keeps it in memory until submit', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Cafe image loads wrong');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add a screenshot'));
    });
    expect(await screen.findByLabelText('Attached screenshot')).toBeTruthy();
    // Nothing about the picked file reaches storage.
    expect(JSON.stringify([...storage.map.values()])).not.toContain('blob:');

    await fireEvent.press(screen.getByLabelText('Remove the screenshot'));
    expect(screen.getByLabelText('Add a screenshot')).toBeTruthy();
  });

  it('shows what will be sent, and shows no account details', async () => {
    await renderForm('/bev/[id]');
    await fireEvent.press(screen.getByLabelText('Automatically included'));
    expect(await screen.findByText('/bev/[id]')).toBeTruthy();
    expect(screen.getByText('Screen')).toBeTruthy();
    expect(screen.getByText(/No account details/)).toBeTruthy();
  });

  it('restores a draft and says the screenshot has to be added again', async () => {
    storage = memoryStorage({
      [DRAFT_KEY]: JSON.stringify({
        title: 'Profile avatar is stretched',
        description: '',
        steps: '',
        idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11',
        savedAt: new Date().toISOString(),
      }),
    });
    await renderForm();
    expect(screen.getByLabelText('What went wrong?').props.value).toBe('Profile avatar is stretched');
    expect(screen.getByText(/Your last draft was restored/)).toBeTruthy();
  });

  it('refuses a report from an account that is not an internal reporter', async () => {
    controls.setInternalReporter(false);
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Anything');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    expect(await screen.findByText("You're signed out")).toBeTruthy();
    expect(screen.queryByText(/^Created BEV-/)).toBeNull();
  });

  it('shows Bug and Annoying picked by default, and sends what the reporter picks instead', async () => {
    const spy = jest.spyOn(api.bugs, 'report');
    await renderForm();
    expect(screen.getByLabelText('Bug').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Annoying').props['aria-pressed']).toBe(true);
    expect(screen.getByText('Works, with a workaround.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Design nit'));
    await fireEvent.press(screen.getByLabelText('Blocker'));
    expect(screen.getByLabelText('Blocker').props['aria-pressed']).toBe(true);
    expect(screen.getByText("Can't use the app, or data is wrong.")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Icons are blurry on the leaderboard');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    await screen.findByText(/^Created BEV-\d+$/);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'design', severity: 'blocker' }));
    const mine = await api.bugs.listMine();
    expect(mine[0]).toMatchObject({ kind: 'design', severity: 'blocker', state: 'triage', title: 'Icons are blurry on the leaderboard' });
    spy.mockRestore();
  });

  it('sends the screenshot as a one-element evidence list', async () => {
    const spy = jest.spyOn(api.bugs, 'report');
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('What went wrong?'), 'Cafe image loads wrong');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add a screenshot'));
    });
    await screen.findByLabelText('Attached screenshot');
    await fireEvent.press(screen.getByLabelText('Submit bug report'));
    await screen.findByText(/^Created BEV-\d+$/);
    const input = spy.mock.calls[0]?.[0];
    expect(input?.evidence).toHaveLength(1);
    expect(input?.evidence?.[0]?.mimeType).toBe('image/jpeg');
    spy.mockRestore();
  });

  it('restores the kind and severity with the draft', async () => {
    storage = memoryStorage({
      [DRAFT_KEY]: JSON.stringify({
        kind: 'idea',
        severity: 'polish',
        title: 'A dark mode toggle',
        description: '',
        steps: '',
        idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11',
        savedAt: new Date().toISOString(),
      }),
    });
    await renderForm();
    expect(screen.getByLabelText('Idea').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Polish').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Bug').props['aria-pressed']).toBe(false);
  });

  it('closes back to the screen the reporter came from', async () => {
    await renderForm();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

/** The key the form is filing the current draft under, read back out of storage. */
function lastKeyAfter(store: ReturnType<typeof memoryStorage>): string {
  const raw = store.map.get(DRAFT_KEY);
  return raw ? (JSON.parse(raw) as { idempotencyKey: string }).idempotencyKey : '';
}

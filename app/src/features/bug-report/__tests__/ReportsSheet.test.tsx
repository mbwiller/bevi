import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';

import { newIdempotencyKey, type StorageLike } from '../draft';
import { emptyDraft } from '../model';
import { ReportsSheet } from '../ReportsSheet';
import { addUnplaced, openReports, resetReport, setReportStorage, useReport, type Sender } from '../store';

jest.mock('../capture', () => ({ captureScreen: jest.fn(async () => null), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/'),
  trailSnapshot: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
}));
jest.mock('../infer', () => ({ inferKind: jest.fn(() => 'bug'), titleFor: jest.fn((note: string) => note) }));
const mockOpenURL = jest.fn();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

let client: QueryClient;
const sender: Sender = (input) => api.bugs.report(input);

async function file(title: string): Promise<string> {
  return (await api.bugs.report({ kind: 'bug', severity: 'annoying', title, idempotencyKey: newIdempotencyKey() })).ticketId;
}

async function renderSheet() {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <QueryClientProvider client={client}>
        <ReportsSheet sender={sender} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await act(async () => openReports());
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  mockOpenURL.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

describe('Filed reports', () => {
  it('sorts tickets into Open (in rank order), In review and a folded Closed', async () => {
    const a = await file('Ticket A');
    await file('Ticket B');
    await file('Ticket C');
    const d = await file('Ticket D');
    const e = await file('Ticket E');
    controls.setBugTicketState(d, 'in_review');
    controls.setBugTicketState(e, 'done');
    // C is on top (newest open), then B, then A; place A above everything.
    await api.bugs.place(a, null);
    await renderSheet();

    expect(await screen.findByText('Open')).toBeTruthy();
    const open = screen.getAllByRole('link').map((l) => l.props.accessibilityLabel as string);
    expect(open.slice(0, 3)).toEqual([
      expect.stringMatching(/^Number 1, Ticket A, /),
      expect.stringMatching(/^Number 2, Ticket C, /),
      expect.stringMatching(/^Number 3, Ticket B, /),
    ]);
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${a} · Triage · `))).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByRole('button', { name: `Verified on device: ${d}` })).toBeTruthy();
    expect(screen.queryByText('Ticket E')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Closed, 1'));
    expect(screen.getByText('Ticket E')).toBeTruthy();

    await fireEvent.press(screen.getAllByRole('link')[0]!);
    expect(mockOpenURL).toHaveBeenCalledWith(expect.stringContaining(a));
  });

  it('asks once before moving a ticket to Done, from the device', async () => {
    const d = await file('Fixed thing');
    await file('Other');
    controls.setBugTicketState(d, 'in_review');
    const verify = jest.spyOn(api.bugs, 'markVerified');
    await renderSheet();
    await fireEvent.press(await screen.findByRole('button', { name: `Verified on device: ${d}` }));
    expect(screen.getByText("Checked on this device and it's fixed?")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Not yet' }));
    expect(verify).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: `Verified on device: ${d}` }));
    await fireEvent.press(screen.getByRole('button', { name: `Yes, ${d} is fixed` }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith(d));
    await fireEvent.press(await screen.findByLabelText('Closed, 1'));
    expect(screen.getByText('Fixed thing')).toBeTruthy();
    verify.mockRestore();
  });

  it('offers to place the reports filed here that are still open', async () => {
    const a = await file('Ticket A');
    const b = await file('Ticket B');
    addUnplaced(a);
    addUnplaced(b);
    addUnplaced('BEV-999');
    await renderSheet();
    await fireEvent.press(await screen.findByRole('button', { name: 'Place 2 reports' }));
    expect(useReport.getState()).toMatchObject({ sheet: 'rank', rankQueue: [a, b] });
  });

  it('a row\'s Place starts ranking that ticket', async () => {
    await file('Ticket A');
    const b = await file('Ticket B');
    await renderSheet();
    await fireEvent.press(await screen.findByRole('button', { name: `Place ${b}` }));
    expect(useReport.getState()).toMatchObject({ sheet: 'rank', rankQueue: [b] });
  });

  it('shows a failed note on top with Try again, which files it under the same key', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    const draft = { ...emptyDraft(newIdempotencyKey(), {}), text: 'It crashed' };
    useReport.setState({ outbox: [{ key: draft.idempotencyKey, title: 'It crashed', status: 'failed', error: new Error('x'), draft }] });
    await renderSheet();
    expect(await screen.findByText("Didn't send. Couldn't load this.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again: It crashed' }));
    await waitFor(() => expect(useReport.getState().outbox[0]?.status).toBe('sent'));
    expect(report.mock.calls[0]![0].idempotencyKey).toBe(draft.idempotencyKey);
    report.mockRestore();
  });

  it('says "Status unavailable" for a ticket the tracker could not report on', async () => {
    const a = await file('Ticket A');
    controls.setBugTicketState(a, 'unknown');
    await renderSheet();
    expect(await screen.findByText(new RegExp(`^${a} · Status unavailable · `))).toBeTruthy();
  });

  it('a failed list offers Retry', async () => {
    controls.failNext('network', 'bugs.listMine');
    await renderSheet();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nothing filed yet')).toBeTruthy();
  });

  it('is empty before anything is filed, and says what it will hold', async () => {
    await renderSheet();
    expect(await screen.findByText('Filed reports')).toBeTruthy();
    const empty = await screen.findByText('Nothing filed yet');
    expect(within(empty.parent!.parent!).getByText('Reports you send show up here with their status and where you ranked them.')).toBeTruthy();
  });

  it('lists every ticket from a server that predates ranking (all ranks null, some state unknown) under Open, newest first', async () => {
    const a = await file('First filed');
    const b = await file('Second filed');
    const c = await file('Third filed');
    controls.setBugTicketState(b, 'unknown');
    const real = api.bugs.listMine.bind(api.bugs);
    const list = jest.spyOn(api.bugs, 'listMine').mockImplementation(async () => (await real()).map((r) => ({ ...r, rank: null })));
    await renderSheet();
    expect(await screen.findByText('Open')).toBeTruthy();
    const links = screen.getAllByRole('link').map((l) => l.props.accessibilityLabel as string);
    expect(links).toEqual([
      expect.stringMatching(new RegExp(`^Third filed, ${c} · `)),
      expect.stringMatching(new RegExp(`^Second filed, ${b} · Status unavailable · `)),
      expect.stringMatching(new RegExp(`^First filed, ${a} · `)),
    ]);
    expect(screen.queryByText('Nothing filed yet')).toBeNull();
    list.mockRestore();
  });
});

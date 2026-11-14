import { ApiError } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import { controls } from '@/testing/fakeApi';
import type { BugReportSummary } from '@bevi/shared';

import { newIdempotencyKey, type StorageLike } from '../draft';
import { RankSheet } from '../RankSheet';
import { addUnplaced, openRank, resetReport, setReportStorage, useReport } from '../store';

jest.mock('../capture', () => ({ captureScreen: jest.fn(async () => null), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []), pickScreen: jest.fn(() => null) }));

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

let client: QueryClient;

async function file(title: string): Promise<string> {
  const result = await api.bugs.report({ kind: 'bug', severity: 'annoying', title, idempotencyKey: newIdempotencyKey() });
  return result.ticketId;
}

/** Files A, B, C, then the new one; each new ticket lands on top, so the list is New, C, B, A. */
async function fourTickets() {
  const a = await file('Ticket A');
  const b = await file('Ticket B');
  const c = await file('Ticket C');
  const fresh = await file('Ticket New');
  return { a, b, c, fresh };
}

async function renderSheet() {
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <QueryClientProvider client={client}>
        <RankSheet />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

/** The card for `title`: pressing it says that one is worse. */
const card = (title: string) => screen.getByLabelText(new RegExp(`^${title}, .*Press if this one is worse\\.$`));

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('Which is worse?', () => {
  it('places a new report by answering the prompts, and the list re-orders', async () => {
    const { b, c, fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    addUnplaced(fresh);
    await renderSheet();
    await act(async () => openRank([fresh]));

    // Three others, so at most two questions; the first is the middle one.
    expect(await screen.findByText('Question 1 of at most 2')).toBeTruthy();
    expect(card('Ticket New')).toBeTruthy();
    expect(card('Ticket B')).toBeTruthy();
    expect(screen.getByText('#2 of 3')).toBeTruthy();
    await fireEvent.press(card('Ticket New'));

    expect(screen.getByText('Question 2 of at most 2')).toBeTruthy();
    expect(card('Ticket C')).toBeTruthy();
    await fireEvent.press(card('Ticket C'));

    await waitFor(() => expect(place).toHaveBeenCalledWith(fresh, c));
    expect(await screen.findByText(/^Placed #2 of 4/)).toBeTruthy();
    const rows = client.getQueryData<BugReportSummary[]>(keys.myBugReports())!;
    expect(rows.filter((r) => r.rank !== null).sort((x, y) => x.rank! - y.rank!).map((r) => r.ticketId)).toEqual([c, fresh, b, expect.any(String)]);
    await waitFor(() => expect(useReport.getState().unplaced).toEqual([]), { timeout: 3000 });
    expect(useReport.getState().sheet).toBeNull();
  });

  it('the worst of all goes to the top: placed after nothing', async () => {
    const { fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    await renderSheet();
    await act(async () => openRank([fresh]));
    await fireEvent.press(await screen.findByLabelText(/^Ticket New, /));
    await fireEvent.press(card('Ticket New'));
    await waitFor(() => expect(place).toHaveBeenCalledWith(fresh, null));
  });

  it('Undo takes the last answer back', async () => {
    const { fresh } = await fourTickets();
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    await fireEvent.press(card('Ticket New'));
    expect(screen.getByText('Question 2 of at most 2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Question 1 of at most 2')).toBeTruthy();
    expect(card('Ticket B')).toBeTruthy();
  });

  it('"About the same" places it directly below the one it was compared with', async () => {
    const { b, fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    await fireEvent.press(screen.getByRole('button', { name: 'About the same' }));
    await waitFor(() => expect(place).toHaveBeenCalledWith(fresh, b));
  });

  it('"Good enough" stops asking and places it in the middle of what is left', async () => {
    const { c, fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Good enough' }));
    // The range is [0, 3]; its middle is index 1, below the first of C, B, A.
    await waitFor(() => expect(place).toHaveBeenCalledWith(fresh, c));
  });

  it('"Skip" leaves it to place later', async () => {
    const { fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    addUnplaced(fresh);
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(place).not.toHaveBeenCalled();
    expect(useReport.getState().unplaced).toEqual([fresh]);
    expect(useReport.getState().sheet).toBeNull();
  });

  it('with nothing else open there is nothing to compare: it is dropped from the list to place, silently', async () => {
    const only = await file('The only one');
    const place = jest.spyOn(api.bugs, 'place');
    addUnplaced(only);
    await renderSheet();
    await act(async () => openRank([only]));
    await waitFor(() => expect(useReport.getState().unplaced).toEqual([]));
    expect(useReport.getState().sheet).toBeNull();
    expect(place).not.toHaveBeenCalled();
  });

  it('says so when the server is older than ranking, and keeps the report to place', async () => {
    const { fresh } = await fourTickets();
    jest.spyOn(api.bugs, 'place').mockRejectedValue(new ApiError('unknown', 'The server predates ranking', { reason: 'place_unsupported' }));
    addUnplaced(fresh);
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Good enough' }));
    expect(await screen.findByText('Ranking turns on when the server is updated. Your report is filed.')).toBeTruthy();
    expect(useReport.getState().unplaced).toEqual([fresh]);
  });

  it('any other failure says what happened and offers Try again', async () => {
    const { c, fresh } = await fourTickets();
    const place = jest.spyOn(api.bugs, 'place');
    controls.failNext('network', 'bugs.place');
    await renderSheet();
    await act(async () => openRank([fresh]));
    await screen.findByText('Question 1 of at most 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Good enough' }));
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Placed #2 of 4/);
    expect(place).toHaveBeenLastCalledWith(fresh, c);
  });
});

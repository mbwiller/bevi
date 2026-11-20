import { REPORT_NOTE_MAX, REPORT_REASONS, type FeedItem } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { api } from '@/api/client';
import { FRIEND, controls, userIdFor } from '@/testing/fakeApi';
import { grabModalDismiss } from '@/testing/modalDismiss';

import { REPORT_REASON_LABELS } from '../copy';
import { SafetyFlow, type SafetyTarget } from '../SafetyFlow';

// The More menu's sheet: Report (reason, note, confirmation, each failure) and Block (what it says,
// what it does), against the FakeApi as ME.

jest.setTimeout(30_000);

let client: QueryClient;
let onClose: jest.Mock;
let onBlocked: jest.Mock;
let post: FeedItem;
let target: SafetyTarget;

function Harness({ t }: { t: SafetyTarget | null }) {
  return (
    <QueryClientProvider client={client}>
      <SafetyFlow target={t} onClose={onClose} onBlocked={onBlocked} />
    </QueryClientProvider>
  );
}

/** Closes for real when asked (the screens do), so the Sheet runs its exit and reports it has closed. */
function Controlled() {
  const [t, setT] = useState<SafetyTarget | null>(target);
  return (
    <QueryClientProvider client={client}>
      <SafetyFlow
        target={t}
        onClose={() => {
          onClose();
          setT(null);
        }}
        onBlocked={onBlocked}
      />
    </QueryClientProvider>
  );
}

/** Waits for the sheet to leave the tree: its Modal is hidden and, on iOS, awaiting UIKit's onDismiss. */
const sheetGone = () => waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  onClose = jest.fn();
  onBlocked = jest.fn();
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  const feed = await api.feed.getFeed({ limit: 20 });
  post = feed.items.find((p) => p.actor.id === userIdFor(FRIEND.handle))!;
  expect(post).toBeDefined();
  target = { kind: 'post', id: post.id, author: post.actor };
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

async function toReportForm() {
  await render(<Harness t={target} />);
  await press('Report post');
}

it('opens on a menu with Report post and Block account, named for the person', async () => {
  await render(<Harness t={target} />);
  expect(screen.getByRole('header', { name: 'More actions' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Report post' })).toBeTruthy();
  expect(screen.getByRole('button', { name: `Block @${FRIEND.handle}` })).toBeTruthy();
});

it('says Report comment and Report profile for those targets', async () => {
  await render(<Harness t={{ ...target, kind: 'comment' }} />);
  expect(screen.getByRole('button', { name: 'Report comment' })).toBeTruthy();
  await screen.unmount();
  await render(<Harness t={{ ...target, kind: 'profile', id: post.actor.id }} />);
  expect(screen.getByRole('button', { name: 'Report profile' })).toBeTruthy();
});

describe('report', () => {
  it('offers every reason with a human label, and will not send without one', async () => {
    await toReportForm();
    for (const r of REPORT_REASONS) expect(screen.getByRole('radio', { name: REPORT_REASON_LABELS[r] })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send report' }).props.accessibilityState?.disabled ?? screen.getByRole('button', { name: 'Send report' }).props['aria-disabled']).toBeTruthy();
    const spy = jest.spyOn(api.reports, 'report');
    await press('Send report');
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the chosen reason and the trimmed note, then confirms and offers Block too', async () => {
    const spy = jest.spyOn(api.reports, 'report');
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Harassment or bullying' }));
    expect(screen.getByRole('radio', { name: 'Harassment or bullying' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.changeText(screen.getByLabelText('Note'), '  rude to me  ');
    await press('Send report');
    expect(await screen.findByText('Thanks, we got your report')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ kind: 'post', id: post.id, reason: 'harassment', note: 'rude to me' });
    expect(screen.getByRole('button', { name: `Block this account too, @${FRIEND.handle}` })).toBeTruthy();
    await press('Done');
    expect(onClose).toHaveBeenCalled();
  });

  it('sends no note when it is blank', async () => {
    const spy = jest.spyOn(api.reports, 'report');
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    await fireEvent.changeText(screen.getByLabelText('Note'), '   ');
    await press('Send report');
    await screen.findByText('Thanks, we got your report');
    expect(spy).toHaveBeenCalledWith({ kind: 'post', id: post.id, reason: 'spam', note: undefined });
  });

  it('counts the note down near the limit and refuses one over it', async () => {
    const spy = jest.spyOn(api.reports, 'report');
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    expect(screen.queryByLabelText(/characters left/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Note'), 'a'.repeat(REPORT_NOTE_MAX - 12));
    expect(screen.getByLabelText('12 characters left')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Note'), 'a'.repeat(REPORT_NOTE_MAX + 3));
    expect(screen.getByLabelText('3 characters over')).toBeTruthy();
    await press('Send report');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rate_limited: says to wait, keeps the draft, and sends on the next try', async () => {
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hate speech' }));
    await fireEvent.changeText(screen.getByLabelText('Note'), 'my words');
    controls.failNext('rate_limited', 'reports.report');
    await press('Send report');
    expect(await screen.findByText(/Wait a minute, then try again/)).toBeTruthy();
    expect(screen.getByLabelText('Note').props.value).toBe('my words');
    await press('Send report');
    expect(await screen.findByText('Thanks, we got your report')).toBeTruthy();
  });

  it('offline: says to check the connection, keeps the draft', async () => {
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Violence or threats' }));
    controls.failNext('network', 'reports.report');
    await press('Send report');
    expect(await screen.findByText("Couldn't send your report. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Violence or threats' }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('not_found: "No longer available", with nothing left to send', async () => {
    await toReportForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    controls.failNext('not_found', 'reports.report');
    await press('Send report');
    expect(await screen.findByText('No longer available')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
    // A way out, as the block step's gone state has.
    expect(onClose).not.toHaveBeenCalled();
    await press('Done');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a post that is really gone reads as no longer available', async () => {
    await render(<Harness t={{ ...target, id: 'no-such-post' }} />);
    await press('Report post');
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    await press('Send report');
    expect(await screen.findByText('No longer available')).toBeTruthy();
  });
});

describe('block', () => {
  it('says plainly what blocking does before it does it', async () => {
    await render(<Harness t={target} />);
    await press(`Block @${FRIEND.handle}`);
    expect(screen.getByRole('header', { name: `Block @${FRIEND.handle}?` })).toBeTruthy();
    expect(screen.getByText(/won't see your posts or profile, and you won't see theirs/)).toBeTruthy();
    expect(screen.getByText(/that follow is removed/)).toBeTruthy();
    expect(screen.getByText(/aren't told/)).toBeTruthy();
    expect((await api.blocks.list()).items).toHaveLength(0);
  });

  it('Cancel goes back to the menu without blocking', async () => {
    await render(<Harness t={target} />);
    await press(`Block @${FRIEND.handle}`);
    await press('Cancel');
    expect(screen.getByRole('button', { name: 'Report post' })).toBeTruthy();
    expect((await api.blocks.list()).items).toHaveLength(0);
  });

  it('Block blocks them, closes the sheet and tells the screen only once the sheet has finished closing', async () => {
    await render(<Controlled />);
    const dismiss = grabModalDismiss();
    await press(`Block @${FRIEND.handle}`);
    await press(`Block @${FRIEND.handle}`);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Closing, not closed: popping the screen now would pop it under a Modal that is still presented.
    expect(onBlocked).not.toHaveBeenCalled();
    await sheetGone();
    expect(onBlocked).not.toHaveBeenCalled();
    await act(() => dismiss());
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith(target);
    expect((await api.blocks.list()).items.map((b) => b.id)).toEqual([post.actor.id]);
  });

  it.each([
    ['rate_limited', /blocked a lot of accounts.*Wait a minute/],
    ['network', /Couldn't block this account\. Check your connection and try again\./],
  ] as const)('%s: says so and stays on the confirmation', async (code, message) => {
    await render(<Harness t={target} />);
    await press(`Block @${FRIEND.handle}`);
    controls.failNext(code, 'blocks.block');
    await press(`Block @${FRIEND.handle}`);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(onBlocked).not.toHaveBeenCalled();
    expect((await api.blocks.list()).items).toHaveLength(0);
  });

  it('after reporting, "Block this account too" leads to the same confirmation', async () => {
    await render(<Controlled />);
    const dismiss = grabModalDismiss();
    await press('Report post');
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam or scam' }));
    await press('Send report');
    await screen.findByText('Thanks, we got your report');
    await press(`Block this account too, @${FRIEND.handle}`);
    expect(screen.getByText(/won't see your posts or profile/)).toBeTruthy();
    await press(`Block @${FRIEND.handle}`);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await sheetGone();
    await act(() => dismiss());
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });
});

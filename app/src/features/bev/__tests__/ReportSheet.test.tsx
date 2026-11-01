import { ApiError } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';

import { ReportSheet } from '../ReportSheet';

// Report Bev (§6.19) and its "Duplicate of another Bev" step (M-20). The FakeApi validates `duplicateOfId`
// as the server does, so a self-pick is a real `validation` error, not a stub.
const COKE = 'coca-cola-classic';
const COKE_NAME = 'Coca-Cola Classic';
const SEARCH = 'Search a Bev, brand or flavor';

let client: QueryClient;
let onClose: jest.Mock;

function Harness({ open }: { open: boolean }) {
  return (
    <QueryClientProvider client={client}>
      <ReportSheet bevId={COKE} name={COKE_NAME} open={open} onClose={onClose} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  onClose = jest.fn();
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

async function toSearchStep() {
  await fireEvent.press(screen.getByLabelText('Duplicate of another Bev'));
  await fireEvent.press(screen.getByLabelText('Next'));
  expect(await screen.findByText('Which Bev is it a duplicate of?')).toBeTruthy();
}

async function search(q: string) {
  await fireEvent.changeText(screen.getByLabelText(SEARCH), q);
}

it('sends a non-duplicate reason without a duplicateOfId and says thanks', async () => {
  const spy = jest.spyOn(api.bevs, 'report');
  await render(<Harness open />);
  expect(screen.getByText(`Report ${COKE_NAME}`)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Wrong category'));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Thanks for the report')).toBeTruthy();
  expect(spy).toHaveBeenCalledWith(COKE, 'wrong_category', undefined);
});

/** A Bev, other than the reported one, whose name no other result for the same search shares. */
async function aDuplicateCandidate() {
  const items = (await api.bevs.search({ q: 'coca', limit: 9 })).items;
  const other = items.find((b) => b.id !== COKE && items.filter((x) => x.name === b.name).length === 1);
  if (!other) throw new Error('the catalog has no second Bev matching "coca"');
  return other;
}

it('Duplicate of another Bev asks which one, then sends duplicateOfId', async () => {
  const other = await aDuplicateCandidate();
  const spy = jest.spyOn(api.bevs, 'report');
  await render(<Harness open />);
  await fireEvent.press(screen.getByLabelText('Duplicate of another Bev'));
  expect(screen.queryByLabelText('Send report')).toBeNull();
  await toSearchStep();

  // Under two characters: a hint, nothing to pick, and sending stays off.
  expect(screen.getByText('Type at least two letters')).toBeTruthy();
  await search('c');
  expect(screen.getByText('Type at least two letters')).toBeTruthy();
  expect(screen.getByLabelText('Send report')).toBeDisabled();

  // The reported Bev matches "coca" too, but is never offered.
  await search('coca');
  expect(await screen.findByLabelText(`Pick ${other.name}`)).toBeTruthy();
  expect(screen.queryByLabelText(`Pick ${COKE_NAME}`)).toBeNull();

  await fireEvent.press(screen.getByLabelText(`Pick ${other.name}`));
  expect(screen.getByLabelText(`Pick ${other.name}`).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByLabelText('Send report')).toBeEnabled();

  // A new query drops the pick, so a Bev that left the results can't be sent.
  await search('coc');
  expect(screen.getByLabelText('Send report')).toBeDisabled();
  await search('coca');
  await fireEvent.press(await screen.findByLabelText(`Pick ${other.name}`));
  expect(screen.getByLabelText('Send report')).toBeEnabled();

  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Thanks for the report')).toBeTruthy();
  expect(spy).toHaveBeenCalledWith(COKE, 'duplicate', { duplicateOfId: other.id });
});

it('says so when nothing matches', async () => {
  await render(<Harness open />);
  await toSearchStep();
  await search('zzqxjv');
  expect(await screen.findByText('No Bevs match')).toBeTruthy();
  expect(screen.getByText('Try the brand or the flavor.')).toBeTruthy();
});

it('Back returns to the reasons with Duplicate still chosen', async () => {
  await render(<Harness open />);
  await toSearchStep();
  await fireEvent.press(screen.getByLabelText('Back'));
  expect(await screen.findByText(`Report ${COKE_NAME}`)).toBeTruthy();
  expect(screen.getByLabelText('Duplicate of another Bev').props['aria-pressed']).toBe(true);
  expect(screen.getByLabelText('Next')).toBeEnabled();
});

it('a rejected duplicateOfId says to pick a different Bev and stays on the search step', async () => {
  const other = await aDuplicateCandidate();
  jest
    .spyOn(api.bevs, 'report')
    .mockRejectedValueOnce(new ApiError('validation', 'Choose the Bev this one duplicates', { field: 'duplicateOfId' }));
  await render(<Harness open />);
  await toSearchStep();
  await search('coca');
  await fireEvent.press(await screen.findByLabelText(`Pick ${other.name}`));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Pick a different Bev to report this one as a duplicate of.')).toBeTruthy();
  expect(screen.getByText('Which Bev is it a duplicate of?')).toBeTruthy();
  expect(screen.queryByText('Thanks for the report')).toBeNull();
  // Picking again clears the message and sends.
  await fireEvent.press(screen.getByLabelText(`Pick ${other.name}`));
  await waitFor(() => expect(screen.queryByText('Pick a different Bev to report this one as a duplicate of.')).toBeNull());
});

it('Back after a rejected duplicate clears the message and keeps the reason', async () => {
  const other = await aDuplicateCandidate();
  jest
    .spyOn(api.bevs, 'report')
    .mockRejectedValueOnce(new ApiError('validation', 'Choose the Bev this one duplicates', { field: 'duplicateOfId' }));
  await render(<Harness open />);
  await toSearchStep();
  await search('coca');
  await fireEvent.press(await screen.findByLabelText(`Pick ${other.name}`));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Pick a different Bev to report this one as a duplicate of.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Back'));
  expect(await screen.findByText(`Report ${COKE_NAME}`)).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Pick a different Bev to report this one as a duplicate of.')).toBeNull());
  expect(screen.getByLabelText('Duplicate of another Bev').props['aria-pressed']).toBe(true);
});

it('another failure keeps the usual copy', async () => {
  jest.spyOn(api.bevs, 'report').mockRejectedValueOnce(new ApiError('rate_limited', 'slow down'));
  await render(<Harness open />);
  await fireEvent.press(screen.getByLabelText('Something else'));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Wait a minute, then try again.')).toBeTruthy();
});

it('reopening after a send starts again at the reasons', async () => {
  const other = await aDuplicateCandidate();
  const view = await render(<Harness open />);
  await toSearchStep();
  await search('coca');
  await fireEvent.press(await screen.findByLabelText(`Pick ${other.name}`));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Thanks for the report')).toBeTruthy();

  await view.rerender(<Harness open={false} />);
  await view.rerender(<Harness open />);
  expect(await screen.findByText(`Report ${COKE_NAME}`)).toBeTruthy();
  expect(screen.getByLabelText('Duplicate of another Bev').props['aria-pressed']).toBe(false);
  expect(screen.getByLabelText('Send report')).toBeDisabled();
});

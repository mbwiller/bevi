import { render, screen } from '@testing-library/react-native';
import type { SubmitRankingResult } from '@bevi/shared';

import { RankResult } from '../RankResult';

let mockReduced = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => mockReduced,
}));

afterEach(() => {
  mockReduced = false;
});

const result = {
  ranking: { position: 3, bucket: 'LOVED', score: 8.94 },
  bucketSize: 31,
} as unknown as SubmitRankingResult;

it('confirms the saved score: ScoreBubble 56 over "#4 of 31 in Loved · 8.9"', async () => {
  await render(<RankResult bevName="Topo Chico" result={result} onDone={() => {}} />);
  expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
  expect(screen.getByText('#4 of 31 in Loved · 8.9')).toBeTruthy();
});

it('springs the bubble in when motion is allowed', async () => {
  await render(<RankResult bevName="Topo Chico" result={result} onDone={() => {}} />);
  expect(screen.getByTestId('result-score').props.entering).toBeDefined();
});

it('under Reduce Motion, the bubble has no entering animation', async () => {
  mockReduced = true;
  await render(<RankResult bevName="Topo Chico" result={result} onDone={() => {}} />);
  expect(screen.getByTestId('result-score').props.entering).toBeUndefined();
  expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
});

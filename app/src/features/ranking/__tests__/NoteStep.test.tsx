import { render, screen } from '@testing-library/react-native';

import { NoteStep, type NoteStepProps } from '../NoteStep';

let mockReduced = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => mockReduced,
}));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  mockReduced = false;
});

const props: NoteStepProps = {
  bucket: 'LOVED',
  score: 8.94,
  position: 3,
  bucketSize: 31,
  note: '',
  onNoteChange: () => {},
  onSave: () => {},
  onSkip: () => {},
  onClose: () => {},
  saving: false,
};

it('reveals the score over "#4 of 31 in Loved" in place of a title, the note below', async () => {
  await render(<NoteStep {...props} />);
  expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
  expect(screen.getByRole('header', { name: '#4 of 31 in Loved' })).toBeTruthy();
  expect(screen.queryByText('Add a note')).toBeNull();
  expect(screen.getByText('Optional. Your friends see it with your ranking.')).toBeTruthy();
  expect(screen.getByLabelText('Note').props.autoFocus).toBe(true);
});

it('pours in and counts up from the bucket\'s lower edge', async () => {
  await render(<NoteStep {...props} bucket="FINE" score={5.5} position={0} bucketSize={1} />);
  expect(screen.getByTestId('note-score').props.entering).toBeDefined();
  expect(screen.getByText('4.0')).toBeTruthy();
  expect(screen.getByText('First one in Fine')).toBeTruthy();
  expect(screen.getByText('Nothing to compare yet. Add a note if you like.')).toBeTruthy();
});

it('under Reduce Motion: no pour-in, the final number at once', async () => {
  mockReduced = true;
  await render(<NoteStep {...props} bucket="DISLIKED" score={2.5} position={1} bucketSize={3} />);
  expect(screen.getByTestId('note-score').props.entering).toBeUndefined();
  expect(screen.getByText('2.5')).toBeTruthy();
  expect(screen.getByText("#2 of 3 in Didn't like")).toBeTruthy();
});

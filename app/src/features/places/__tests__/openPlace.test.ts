import { openPlace } from '../openPlace';

it('opens the Map tab on the venue, in the view its post belongs to', () => {
  const push = jest.fn();
  openPlace({ push }, { id: 'v1' }, 'mine')!();
  openPlace({ push }, { id: 'v2' }, 'friends')!();
  expect(push.mock.calls).toEqual([
    [{ pathname: '/map', params: { venue: 'v1', scope: 'mine' } }],
    [{ pathname: '/map', params: { venue: 'v2', scope: 'friends' } }],
  ]);
});

it('is nothing to press for a post with no place', () => {
  const push = jest.fn();
  expect(openPlace({ push }, null, 'mine')).toBeUndefined();
  expect(openPlace({ push }, undefined, 'friends')).toBeUndefined();
});

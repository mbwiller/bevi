import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { motion } from '@/theme';

import { BevList, type ListQueryState } from '../BevList';

jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return { ...mock, useReducedMotion: () => false, withTiming: jest.fn(mock.withTiming) };
});
const { withTiming } = jest.requireMock('react-native-reanimated') as { withTiming: jest.Mock };

const mockScrollToOffset = jest.fn();
let mockLastProps: Record<string, any> = {};

jest.mock('@shopify/flash-list', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    FlashList: forwardRef((props: any, ref: any) => {
      mockLastProps = props;
      useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset }));
      return (
        <>
          {props.ListHeaderComponent}
          {props.data.map((item: unknown, index: number) => props.renderItem({ item, index }))}
        </>
      );
    }),
  };
});

const query = { isPending: false, isError: false, error: null, refetch: jest.fn() };

function list(resetScrollKey?: string): ReactElement {
  return (
    <BevList
      data={['a', 'b']}
      query={query}
      renderItem={({ item }) => <Text key={item}>{item}</Text>}
      keyExtractor={(x) => x}
      header={<Text>header</Text>}
      empty={null}
      resetScrollKey={resetScrollKey}
    />
  );
}

beforeEach(() => mockScrollToOffset.mockClear());

it('turns maintainVisibleContentPosition off', async () => {
  await render(list('k1'));
  expect(mockLastProps.maintainVisibleContentPosition).toEqual({ disabled: true });
});

it('does not scroll on first mount or when the key is unchanged', async () => {
  const view = await render(list('k1'));
  await view.rerender(list('k1'));
  expect(mockScrollToOffset).not.toHaveBeenCalled();
});

it('scrolls to the top once when the key changes', async () => {
  const view = await render(list('k1'));
  await view.rerender(list('k2'));
  expect(mockScrollToOffset).toHaveBeenCalledTimes(1);
  expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
});

describe('Arrive', () => {
  const rows = (q: Partial<ListQueryState>, data: string[] = ['a', 'b']) => (
    <BevList
      data={data}
      query={{ ...query, ...q }}
      renderItem={({ item }) => <Text key={item}>{item}</Text>}
      keyExtractor={(x) => x}
      empty={<Text>empty</Text>}
    />
  );
  /** Arrivals played so far: a run to 1 over motion.base. */
  const arrivals = () => withTiming.mock.calls.filter(([to, c]) => to === 1 && c?.duration === motion.base);

  beforeEach(() => withTiming.mockClear());

  it('the rows that replace the skeleton rise in once; a refetch or the next page does not replay it', async () => {
    const view = await render(rows({ isPending: true }, []));
    expect(arrivals()).toHaveLength(0);
    await view.rerender(rows({}));
    expect(arrivals()).toHaveLength(1);
    // Each row sits in the arrival's wrapper (transform and opacity only) and first paints its start pose.
    expect(view.getByText('a').parent).toHaveStyle({ opacity: 0, transform: [{ translateY: 6 }] });
    await view.rerender(rows({ isRefetching: true }));
    expect(view.getByText('a').parent).toHaveStyle({ opacity: 1, transform: [{ translateY: 0 }] });
    await view.rerender(rows({ isFetchingNextPage: true }, ['a', 'b', 'c']));
    await view.rerender(rows({}, ['a', 'b', 'c']));
    expect(arrivals()).toHaveLength(1);
  });

  it('a list that mounts with its rows already cached holds still', async () => {
    const view = await render(rows({}));
    await view.rerender(rows({}));
    expect(arrivals()).toHaveLength(0);
  });
});

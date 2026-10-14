import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { BevList } from '../BevList';

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

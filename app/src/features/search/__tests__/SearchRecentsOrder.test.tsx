import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import AddBevTab from '@/app/(tabs)/add/index';
import { controls } from '@/testing/fakeApi';

import { POPULAR_TITLE } from '../SearchPanel';

// The idle list's order on screen: Recents, then Popular on Bevi. On native Recents arrive from
// AsyncStorage after Popular's header is already showing, and FlashList's test tree keeps cells in
// arrival order, so this file renders the list's data in order instead (as BevList.test.tsx does).

let mockLastProps: Record<string, any> = {};

jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement } = jest.requireActual('react');
  return {
    FlashList: forwardRef((props: any, _ref: unknown) => {
      mockLastProps = props;
      return createElement(
        Fragment,
        null,
        props.data.map((item: unknown, index: number) =>
          createElement(Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index })),
        ),
      );
    }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: () => () => {}, isFocused: () => true, setParams: jest.fn() }),
  useIsFocused: () => true,
}));

const headings = () =>
  screen
    .getAllByRole('heading')
    .filter((h) => h.props['aria-level'] === 2)
    .map((h) => h.props.children as string);

it('shows Recents above Popular on Bevi once they have been read', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('bevi.add.recents:user-tester', JSON.stringify([{ id: 'b-1', name: 'Topo Chico', brand: 'Topo Chico' }]));
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(keys.me(), await api.profile.getMe());
  await render(
    <QueryClientProvider client={client}>
      <AddBevTab />
    </QueryClientProvider>,
  );
  await screen.findByText('Recents');
  await screen.findByText(POPULAR_TITLE);
  expect(headings()).toEqual(['Recents', POPULAR_TITLE]);
  // The order in the data is not enough on a phone: with this on, the real FlashList keeps Popular
  // where it was and puts the late Recents rows above the top edge, where nobody sees them.
  expect(mockLastProps.maintainVisibleContentPosition).toEqual({ disabled: true });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  client.clear();
});

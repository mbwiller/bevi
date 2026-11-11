import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

import { SearchScreen, type FocusRequest } from '@/features/search/SearchScreen';

/** The slice of the tab navigator this screen uses: its tab's `tabPress` (from `(tabs)/_layout`) and its own params. */
interface TabNavigation {
  addListener(type: 'tabPress', listener: () => void): () => void;
  isFocused(): boolean;
  setParams(params: { focus?: string }): void;
}

/**
 * The Add Bev tab (the URL is /add, and /search redirects here). `?focus=1` (Feed's search bar,
 * "Add a Bev" links) focuses the bar, once: the param is cleared so a later visit doesn't. Pressing
 * the Add Bev tab while it shows empties the bar and blurs it.
 */
export default function AddBevTab() {
  const navigation = useNavigation() as unknown as TabNavigation;
  const params = useLocalSearchParams<{ focus?: string }>();
  const wantsFocus = params.focus === '1';
  const [focus, setFocus] = useState<FocusRequest>({ n: 0 });
  const [reset, setReset] = useState(0);

  useEffect(() => {
    if (!wantsFocus) return;
    setFocus((f) => ({ n: f.n + 1 }));
    // The screen's own navigation, not the router's: on a cold-start deep link the router isn't
    // ready yet when this runs, and router.setParams throws.
    navigation.setParams({ focus: undefined });
  }, [wantsFocus, navigation]);

  useEffect(
    () =>
      navigation.addListener('tabPress', () => {
        if (navigation.isFocused()) setReset((n) => n + 1);
      }),
    [navigation],
  );

  return <SearchScreen focusRequest={focus} resetRequest={reset} />;
}

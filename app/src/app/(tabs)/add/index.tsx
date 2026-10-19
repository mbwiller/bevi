import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

import { SearchScreen, type FocusRequest } from '@/features/search/SearchScreen';

/** The slice of the tab navigator this screen uses: its tab's `tabPress` (from `(tabs)/_layout`) and its own params. */
interface TabNavigation {
  addListener(type: 'tabPress', listener: () => void): () => void;
  isFocused(): boolean;
  setParams(params: { tab?: string; focus?: string }): void;
}

/**
 * The Search tab (TASKS.md M-15; the URL stays /add, and /search redirects here). `?focus=1` (Feed's
 * search bar, "Add a Bev" links) and `?tab=people` (Find people, with "Suggested for you" first)
 * open the results panel with the bar focused, once: the params are cleared so a later tab press
 * lands on the map. Pressing the Search tab while it shows closes the panel.
 */
export default function SearchTab() {
  const navigation = useNavigation() as unknown as TabNavigation;
  const params = useLocalSearchParams<{ tab?: string; focus?: string }>();
  const people = params.tab === 'people';
  const wantsPanel = people || params.focus === '1';
  const [focus, setFocus] = useState<FocusRequest>({ n: 0 });
  const [close, setClose] = useState(0);

  useEffect(() => {
    if (!wantsPanel) return;
    setFocus((f) => ({ n: f.n + 1, people }));
    // The screen's own navigation, not the router's: on a cold-start deep link the router isn't
    // ready yet when this runs, and router.setParams throws.
    navigation.setParams({ tab: undefined, focus: undefined });
  }, [wantsPanel, people, navigation]);

  useEffect(
    () =>
      navigation.addListener('tabPress', () => {
        if (navigation.isFocused()) setClose((n) => n + 1);
      }),
    [navigation],
  );

  return <SearchScreen focusRequest={focus} closeRequest={close} />;
}

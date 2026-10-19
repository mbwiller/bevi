import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { SearchScreen } from '@/features/search/SearchScreen';

/**
 * The Search tab (TASKS.md M-15; the URL stays /add, and /search redirects here). `?focus=1` (Feed's
 * search bar) and `?tab=people` (Find people, older links) open the results panel with the bar
 * focused, once: the params are cleared so a later tab press lands on the map.
 */
export default function SearchTab() {
  const { setParams } = useRouter();
  const params = useLocalSearchParams<{ tab?: string; focus?: string }>();
  const wantsPanel = params.tab === 'people' || params.focus === '1';
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (!wantsPanel) return;
    setRequest((n) => n + 1);
    setParams({ tab: undefined, focus: undefined });
  }, [wantsPanel, setParams]);
  return <SearchScreen focusRequest={request} />;
}

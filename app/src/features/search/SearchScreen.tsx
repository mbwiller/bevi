import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { Pill } from '@/components/Pill';
import { SearchBar } from '@/components/SearchBar';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { spacing, useTheme } from '@/theme';

import { SearchPanel } from './SearchPanel';

export const SEARCH_TITLE = 'Add a Bev';
export const SEARCH_PLACEHOLDER = 'Search a Bev or a person';

/** A link asked for the bar focused; each new `n` focuses it once. */
export interface FocusRequest {
  n: number;
}

export interface SearchScreenProps {
  focusRequest?: FocusRequest;
  /** Bumped by the route when the Add Bev tab is pressed while showing: each new value clears and blurs the bar. */
  resetRequest?: number;
}

/**
 * The Add Bev tab (design system ScreenSearch, without the map since the 2026-11 navigation
 * redesign): the "Add a Bev" header, one outlined bar for Bevs and people, Snap it, then the
 * results list as the screen's body (Recents and "Popular on Bevi" while the bar is empty, grouped
 * Bevs and People once it has text). Pressing the Add Bev tab again empties the bar and puts the
 * keyboard away.
 */
export function SearchScreen({ focusRequest, resetRequest = 0 }: SearchScreenProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  // Debounced here, not in the list, so the first keystroke doesn't search on its own.
  const query = useDebouncedValue(q.trim());

  // A link asked for the bar focused: remount it with autoFocus to bring the keyboard up.
  const [barKey, setBarKey] = useState(0);
  const focusN = focusRequest?.n ?? 0;
  useEffect(() => {
    if (focusN) setBarKey((k) => k + 1);
  }, [focusN]);

  useEffect(() => {
    if (!resetRequest) return;
    setQ('');
    // Blurs the focused field (react-native-web's Keyboard.dismiss blurs the active input).
    Keyboard.dismiss();
  }, [resetRequest]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={SEARCH_TITLE} />
      <View style={styles.query}>
        <SearchBar
          key={barKey}
          variant="outlined"
          placeholder={SEARCH_PLACEHOLDER}
          value={q}
          onChange={setQ}
          autoFocus={barKey > 0}
          id="search-q"
          style={styles.bar}
        />
      </View>
      <View style={styles.pills}>
        <Pill variant="filled" icon="camera" onPress={() => router.push('/add/new')} accessibilityLabel="Snap it: add a Bev from a photo">
          Snap it
        </Pill>
      </View>
      <View testID="search-results" style={[styles.body, { borderTopColor: colors.border }]}>
        <SearchPanel q={q} query={query} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // The mock's `.sr-q-tight`: the header sits directly above, so the bar's top padding drops to `xs`.
  query: { paddingTop: spacing.xs, paddingBottom: spacing.md, paddingHorizontal: spacing.gutter },
  bar: { alignSelf: 'stretch' },
  pills: { flexDirection: 'row', paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  body: { flex: 1, borderTopWidth: 1 },
});

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Header } from '@/components/Header';
import { Pill } from '@/components/Pill';
import { SearchBar } from '@/components/SearchBar';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { useBack } from '@/lib/useBack';
import { motion, spacing, useTheme } from '@/theme';

import { MapPlaceholder } from './MapPlaceholder';
import { initialPanel, panelMode, panelReducer } from './panel';
import { SearchPanel } from './SearchPanel';

export const SEARCH_PLACEHOLDER = 'Search a Bev or a person';

/** A link asked for the panel up and the bar focused; each new `n` opens it once. */
export interface FocusRequest {
  n: number;
  /** Find people: "Suggested for you" above Recents. */
  people?: boolean;
}

export interface SearchScreenProps {
  focusRequest?: FocusRequest;
  /** Bumped by the route when the Search tab is pressed while showing: each new value closes the panel. */
  closeRequest?: number;
}

/**
 * The Search tab (TASKS.md M-15, decision 32; design system ScreenSearch): the wordmark header, one
 * bar for Bevs and people, Snap it, then the map area filling the rest. Focusing or typing in the
 * bar slides the results panel over the map from under it; Cancel slides it away. The map area
 * stays mounted throughout (the live map, M-16, must be created once per session) and takes no
 * gestures (or screen-reader and keyboard focus) while the panel is up. Pressing the Search tab
 * again closes the panel.
 */
export function SearchScreen({ focusRequest, closeRequest = 0 }: SearchScreenProps) {
  const back = useBack();
  const router = useRouter();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [panel, dispatch] = useReducer(panelReducer, initialPanel);
  const mode = panelMode(panel);
  const up = mode !== 'map';
  // Debounced here, not in the panel: the panel mounts on the first keystroke, and a debounce that
  // started there would search for that first character at once.
  const query = useDebouncedValue(panel.q.trim());

  // A link asked for the panel: open it and remount the bar with autoFocus to bring the keyboard up.
  const [barKey, setBarKey] = useState(0);
  const [suggestionsFirst, setSuggestionsFirst] = useState(false);
  const focusN = focusRequest?.n ?? 0;
  const focusPeople = focusRequest?.people ?? false;
  useEffect(() => {
    if (!focusN) return;
    dispatch({ type: 'focus' });
    setSuggestionsFirst(focusPeople);
    setBarKey((k) => k + 1);
  }, [focusN, focusPeople]);

  const cancel = useCallback(() => {
    dispatch({ type: 'cancel' });
    setSuggestionsFirst(false);
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    if (closeRequest) cancel();
  }, [closeRequest, cancel]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header wordmark actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }]} />
      <View style={styles.query}>
        <SearchBar
          key={barKey}
          variant="outlined"
          placeholder={SEARCH_PLACEHOLDER}
          value={panel.q}
          onChange={(q) => dispatch({ type: 'type', q })}
          onClear={() => dispatch({ type: 'clear' })}
          onFocus={() => dispatch({ type: 'focus' })}
          autoFocus={barKey > 0}
          id="search-q"
          style={styles.bar}
        />
        {up ? (
          <Button variant="ghost" onPress={cancel}>
            Cancel
          </Button>
        ) : null}
      </View>
      <View style={styles.pills}>
        <Pill variant="filled" icon="camera" onPress={() => router.push('/add/new')} accessibilityLabel="Snap it: add a Bev from a photo">
          Snap it
        </Pill>
      </View>
      <View style={[styles.area, { borderTopColor: colors.border }]}>
        <View
          testID="search-map"
          style={StyleSheet.absoluteFill}
          pointerEvents={up ? 'none' : 'auto'}
          importantForAccessibility={up ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={up}
          // react-native-web ignores the two above: hide it from screen readers and the Tab key there.
          aria-hidden={up}
          tabIndex={up ? -1 : undefined}
        >
          <MapPlaceholder />
        </View>
        {up ? (
          <Animated.View
            testID="search-panel"
            entering={reduced ? undefined : FadeInDown.duration(motion.base)}
            exiting={reduced ? undefined : FadeOutUp.duration(motion.fast)}
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]}
          >
            <SearchPanel q={panel.q} query={query} suggestionsFirst={suggestionsFirst} />
          </Animated.View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  query: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  bar: { flex: 1 },
  pills: { flexDirection: 'row', paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  area: { flex: 1, borderTopWidth: 1 },
});

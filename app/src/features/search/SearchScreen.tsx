import { useRouter } from 'expo-router';
import { useEffect, useReducer, useState } from 'react';
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

export interface SearchScreenProps {
  /**
   * Bumped by the route when a link asks for the panel up and the bar focused (Feed's search bar,
   * Find people): each new value opens it once.
   */
  focusRequest?: number;
}

/**
 * The Search tab (TASKS.md M-15, decision 32; design system ScreenSearch): the wordmark header, one
 * bar for Bevs and people, Snap it, then the map area filling the rest. Focusing or typing in the
 * bar slides the results panel over the map from under it; Cancel slides it away. The map area
 * stays mounted throughout (the live map, M-16, must be created once per session) and takes no
 * gestures while the panel is up.
 */
export function SearchScreen({ focusRequest = 0 }: SearchScreenProps) {
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
  useEffect(() => {
    if (!focusRequest) return;
    dispatch({ type: 'focus' });
    setBarKey((k) => k + 1);
  }, [focusRequest]);

  const cancel = () => {
    dispatch({ type: 'cancel' });
    Keyboard.dismiss();
  };

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
            <SearchPanel q={panel.q} query={query} />
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

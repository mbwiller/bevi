import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Header } from '@/components/Header';
import { Pill } from '@/components/Pill';
import { SearchBar, type SearchBarBlurEvent } from '@/components/SearchBar';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { spacing, useTheme } from '@/theme';

import { SearchPanel } from './SearchPanel';

export const SEARCH_TITLE = 'Add a Bev';
export const SEARCH_PLACEHOLDER = 'Search a Bev or a person';
/** The bar's and Cancel's DOM ids on the web, which tell a blur where focus went. */
const BAR_ID = 'search-q';
const CANCEL_ID = 'search-cancel';
/**
 * How long after a pointer up or leave Cancel waits for the click that finishes a press before it
 * treats the press as abandoned. A click follows its pointer up at once; this only has to outlast it.
 */
export const CANCEL_SETTLE_MS = 250;

/** The element taking focus from a blur (web), and whether it is inside the element with `id`. */
function focusGoesTo(e: { nativeEvent?: unknown } | undefined, id: string): boolean {
  const next = (e?.nativeEvent as { relatedTarget?: { closest?: (selector: string) => unknown } | null } | undefined)?.relatedTarget;
  return !!next?.closest?.(`#${id}`);
}

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
 * Bevs and People once it has text). While the bar is in use (focused or holding text) a ghost
 * Cancel sits beside it; Cancel, or pressing the Add Bev tab again, empties the bar and puts the
 * keyboard away. Focusing the empty bar and then tapping elsewhere hides Cancel again.
 *
 * Cancel must stay reachable while the bar is giving up focus to it:
 * - Pointer: pressing Cancel blurs the bar on pointer down, well before the press lands on click. If
 *   that blur hid Cancel, the bar would widen into its place and the click would focus the bar again.
 *   So Cancel stays up while a pointer is down on it. A press that never lands (dragged off, cancelled)
 *   settles on pointer cancel at once, or `CANCEL_SETTLE_MS` after pointer up or leave: if the bar is
 *   then empty and unfocused, and Cancel doesn't have focus, Cancel hides.
 * - Keyboard: Tab from the empty bar moves focus to Cancel itself, so that blur leaves it up; it hides
 *   once focus leaves Cancel for anything but the bar.
 */
export function SearchScreen({ focusRequest, resetRequest = 0 }: SearchScreenProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  /** Cancel shows while this is true or the bar holds text. */
  const [focused, setFocused] = useState(false);
  /** The bar has focus right now (raw focus and blur). */
  const barFocused = useRef(false);
  /** A pointer is down on Cancel. */
  const pressing = useRef(false);
  /** Cancel itself has focus from the keyboard (a press that focuses it on pointer down doesn't count). */
  const cancelFocused = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `q` for the handlers and the settle timer, which run after the render that set it. */
  const qNow = useRef(q);
  useEffect(() => {
    qNow.current = q;
  }, [q]);
  // Debounced here, not in the list, so the first keystroke doesn't search on its own.
  const query = useDebouncedValue(q.trim());

  // A link asked for the bar focused: remount it with autoFocus to bring the keyboard up.
  const [barKey, setBarKey] = useState(0);
  const focusN = focusRequest?.n ?? 0;
  useEffect(() => {
    if (focusN) setBarKey((k) => k + 1);
  }, [focusN]);

  const clearSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);
  useEffect(() => clearSettle, [clearSettle]);

  /** A press on Cancel ended without landing: hide it if nothing is left for it to do. */
  const settle = useCallback(() => {
    clearSettle();
    if (!pressing.current) return;
    pressing.current = false;
    if (!barFocused.current && !cancelFocused.current && qNow.current === '') setFocused(false);
  }, [clearSettle]);
  const settleSoon = useCallback(() => {
    clearSettle();
    settleTimer.current = setTimeout(settle, CANCEL_SETTLE_MS);
  }, [clearSettle, settle]);

  const reset = useCallback(() => {
    clearSettle();
    pressing.current = false;
    setQ('');
    setFocused(false);
    // Blurs the focused field (react-native-web's Keyboard.dismiss blurs the active input).
    Keyboard.dismiss();
  }, [clearSettle]);

  useEffect(() => {
    if (resetRequest) reset();
  }, [resetRequest, reset]);

  const showCancel = focused || q.length > 0;

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
          onFocus={() => {
            barFocused.current = true;
            setFocused(true);
          }}
          onBlur={(e: SearchBarBlurEvent) => {
            barFocused.current = false;
            if (pressing.current || focusGoesTo(e, CANCEL_ID)) return;
            setFocused(false);
          }}
          autoFocus={barKey > 0}
          id={BAR_ID}
          style={styles.bar}
        />
        {showCancel ? (
          <View
            id={CANCEL_ID}
            testID="search-cancel"
            onPointerDown={() => {
              clearSettle();
              pressing.current = true;
            }}
            onPointerUp={settleSoon}
            onPointerLeave={settleSoon}
            onPointerCancel={settle}
            onFocus={() => (cancelFocused.current = !pressing.current)}
            onBlur={(e) => {
              cancelFocused.current = false;
              if (pressing.current || focusGoesTo(e, CANCEL_ID) || focusGoesTo(e, BAR_ID)) return;
              if (!barFocused.current && qNow.current === '') setFocused(false);
            }}
          >
            <Button variant="ghost" onPress={reset}>
              Cancel
            </Button>
          </View>
        ) : null}
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
  query: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  bar: { flex: 1 },
  pills: { flexDirection: 'row', paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  body: { flex: 1, borderTopWidth: 1 },
});

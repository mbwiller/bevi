import { Platform } from 'react-native';

/**
 * Where the internal bug reporter exists (docs/bug-workflow.md): the web, where it is built on the
 * DOM, and iOS, where it is built on a real screenshot of the window and the touches the app's root
 * hears (capabilities.ts says what each platform's reporter can do). Anywhere else
 * nobody can report, whatever `bugs.canReport()` would say, so the entry points stay closed and the
 * server is never asked.
 *
 * Even where it is supported, an account that `canReport()` answers false for never loads the
 * reporter: it is a lazy import (loadHost.ts) mounted for internal reporters only.
 */
export const REPORTER_SUPPORTED = Platform.OS === 'web' || Platform.OS === 'ios';

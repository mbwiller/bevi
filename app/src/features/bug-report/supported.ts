import { Platform } from 'react-native';

/**
 * The internal bug reporter exists on the web only (docs/bug-workflow.md): it is built on the DOM.
 * Off the web nobody can report, whatever `bugs.canReport()` would say, so the report button, the
 * Settings rows and /report-bug stay closed and the server is never asked.
 */
export const REPORTER_SUPPORTED = Platform.OS === 'web';

import { create } from 'zustand';

/**
 * The one way the rest of the app asks the reporter for something (Settings' two rows, the old
 * /report-bug link). It is deliberately tiny and imports nothing of the reporter: the reporter
 * itself is lazy-loaded for internal accounts only (ReportHost), and a screen that imported its
 * store would pull the whole thing into every account's bundle. A request made before the host has
 * loaded waits here until it mounts and takes it.
 */

/** 'note': open the note (a new one when there is none, with no capture). 'reports': the reports sheet. */
export type ReportCommand = 'note' | 'reports';

export const useReportCommands = create<{ pending: ReportCommand | null }>(() => ({ pending: null }));

export function requestReport(command: ReportCommand): void {
  useReportCommands.setState({ pending: command });
}

/** The host's side: the pending request, cleared. */
export function takeReportCommand(): ReportCommand | null {
  const { pending } = useReportCommands.getState();
  if (pending) useReportCommands.setState({ pending: null });
  return pending;
}

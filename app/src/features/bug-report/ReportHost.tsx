import { usePathname, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyBugReports, useReportBug } from '@/api/hooks';
import { useTheme } from '@/theme';

import { takeReportCommand, useReportCommands } from './commands';
import { safeRoutePattern, safeStartTrail } from './engine';
import { isOpen } from './labels';
import { Highlight } from './Highlight';
import { RankSheet } from './RankSheet';
import { ReportDrop } from './ReportDrop';
import { ReportLayer } from './ReportLayer';
import { ReportNote } from './ReportNote';
import { ReportsSheet } from './ReportsSheet';
import { ReportToast } from './ReportToast';
import {
  hydrate,
  navigate,
  openBlankNote,
  openReports,
  pruneUnplaced,
  sendNote,
  setContextInput,
  useReport,
  type Sender,
} from './store';

/**
 * The internal bug reporter (docs/bug-workflow.md), mounted once by the root layout for a signed-in
 * internal reporter, and lazy-loaded so no other account downloads any of it.
 *
 * It keeps the trail running, tells the store about every navigation (a new path is a new visit,
 * which gets its own picture), files notes through the `bugs.report` mutation, and draws the drop,
 * the highlight, the note, the toast and the two sheets on a layer above everything (ReportLayer).
 */
export default function ReportHost() {
  const segments = useSegments();
  const pathname = usePathname();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync } = useReportBug();

  // Effects run in order: the trail first, so the first navigation is in it.
  useEffect(() => safeStartTrail(), []);

  useEffect(() => {
    setContextInput({ scheme, insets: { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left } });
  }, [scheme, insets.top, insets.right, insets.bottom, insets.left]);

  const segmentKey = segments.join('/');
  useEffect(() => {
    navigate(safeRoutePattern(segmentKey ? segmentKey.split('/') : []), pathname || '/');
  }, [segmentKey, pathname]);

  // After the two above, so a restored note's environment is this screen's.
  useEffect(() => hydrate(), []);

  // Requests from the rest of the app (Settings, the old /report-bug link), including one made
  // before this finished loading.
  const command = useReportCommands((s) => s.pending);
  useEffect(() => {
    const next = takeReportCommand();
    if (next === 'note') openBlankNote();
    else if (next === 'reports') openReports();
  }, [command]);

  const sender: Sender = useCallback((input) => mutateAsync(input), [mutateAsync]);
  const send = useCallback(() => void sendNote(sender), [sender]);

  // The list is asked for only when something needs it: tickets to place, a toast, a sheet.
  const unplaced = useReport((s) => s.unplaced);
  const needsList = useReport((s) => s.unplaced.length > 0 || s.toast !== null || s.sheet !== null);
  const mine = useMyBugReports(needsList);
  const openIds = useMemo(() => new Set((mine.data ?? []).filter(isOpen).map((r) => r.ticketId)), [mine.data]);
  // Until the list answers, every unplaced ticket counts; afterwards only the ones still open.
  const toPlace = mine.data ? unplaced.filter((id) => openIds.has(id)).length : unplaced.length;
  useEffect(() => {
    if (mine.data) pruneUnplaced(openIds, new Set(mine.data.map((r) => r.ticketId)));
  }, [mine.data, openIds]);
  const canPlace = useCallback((ticketId: string) => [...openIds].some((id) => id !== ticketId), [openIds]);

  return (
    <ReportLayer>
      <Highlight />
      <ReportNote onSend={send} />
      <ReportToast canPlace={canPlace} />
      <ReportDrop toPlace={toPlace} />
      <ReportsSheet sender={sender} />
      <RankSheet />
    </ReportLayer>
  );
}

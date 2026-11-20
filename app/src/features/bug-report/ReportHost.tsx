import { usePathname, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyBugReports, useReportBug } from '@/api/hooks';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

import { CAPABILITIES, FULL_SCREEN_ROUTES } from './capabilities';
import { takeReportCommand, useReportCommands } from './commands';
import { useStorageReady } from './draftStorage';
import { safeRoutePattern, safeStartTrail } from './engine';
import { isOpen } from './labels';
import { Highlight } from './Highlight';
import { RankSheet } from './RankSheet';
import { ReportButton } from './ReportButton';
import { ReportLayer } from './ReportLayer';
import { ReportNote } from './ReportNote';
import { ReportsSheet } from './ReportsSheet';
import { ReportToast } from './ReportToast';
import { SelectBanner } from './SelectBanner';
import {
  abandonModes,
  hydrate,
  navigate,
  openBlankNote,
  openReports,
  pruneUnplaced,
  sendNote,
  setContextInput,
  setOnFullScreen,
  useReport,
  type Sender,
} from './store';

/**
 * The internal bug reporter (docs/bug-workflow.md), mounted once by the root layout for a signed-in
 * internal reporter, and lazy-loaded so no other account downloads any of it.
 *
 * It keeps the trail running, tells the store about every navigation (a new path is a new visit,
 * which gets its own picture), files notes through the `bugs.report` mutation, and draws the
 * floating button, select mode's banner and highlight, the note and the toast on a layer above
 * everything (ReportLayer), and the two sheets beside it. While steps are recorded only the button
 * (as Stop) shows. On iOS there is no select mode and no recording, a new note opens with a
 * screenshot already taken, and the sheets stay closed over a full-screen flow (capabilities.ts).
 */
export default function ReportHost() {
  const segments = useSegments();
  const pathname = usePathname();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync } = useReportBug();
  const handle = useSession((s) => s.profile?.handle);

  // Effects run in order: the trail first, so the first navigation is in it.
  useEffect(() => safeStartTrail(), []);

  // Select mode and a recording never outlive the host (store.abandonModes).
  useEffect(() => () => abandonModes(), []);

  useEffect(() => {
    setContextInput({ scheme, insets: { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left } });
  }, [scheme, insets.top, insets.right, insets.bottom, insets.left]);

  const segmentKey = segments.join('/');
  useEffect(() => {
    navigate(safeRoutePattern(segmentKey ? segmentKey.split('/') : []), pathname || '/');
  }, [segmentKey, pathname]);

  // Whether a full-screen flow is on show, where the two sheets can't open (capabilities.ts).
  const first = segments[0] ?? '';
  useEffect(() => setOnFullScreen(!CAPABILITIES.sheetsOverFullScreen && FULL_SCREEN_ROUTES.includes(first)), [first]);

  // After the two above, so a restored note's environment is this screen's, and once storage has
  // been read (on iOS it answers asynchronously). Another account's state or storage is wiped
  // here rather than restored.
  const storageReady = useStorageReady();
  useEffect(() => {
    if (storageReady) hydrate(handle);
  }, [handle, storageReady]);

  // Requests from the rest of the app (Settings, the old /report-bug link), including one made
  // before this finished loading.
  const command = useReportCommands((s) => s.pending);
  useEffect(() => {
    const next = takeReportCommand();
    if (next === 'note') openBlankNote();
    else if (next === 'note-bare') openBlankNote({ shot: false });
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

  const recording = useReport((s) => s.recording !== null);
  const selecting = useReport((s) => s.selecting);

  return (
    <>
      <ReportLayer>
        {recording ? null : <Highlight />}
        {selecting ? <SelectBanner /> : null}
        {recording || selecting ? null : (
          <>
            <ReportNote onSend={send} />
            <ReportToast canPlace={canPlace} />
          </>
        )}
        <ReportButton toPlace={toPlace} />
      </ReportLayer>
      {/* Beside the layer, not in it: they are Modals (the app's Sheet), which a layer on iOS can't hold. */}
      {recording ? null : (
        <>
          <ReportsSheet sender={sender} />
          <RankSheet />
        </>
      )}
    </>
  );
}

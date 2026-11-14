import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useCanReportBug } from '@/api/hooks';
import { requestReport } from '@/features/bug-report/commands';

/**
 * The old address of the bug reporter, kept so links to it still work. The reporter is now the
 * floating button on every screen (features/bug-report/ReportHost), so this opens a new note there
 * and goes straight back to where the link was opened from (the Feed when there is nothing to go
 * back to). It asks for the note only once `bugs.canReport()` says yes: for anyone else it just
 * goes back, so no request is left waiting for whoever signs in next.
 */
export default function ReportBugScreen() {
  const router = useRouter();
  const { data: canReport, status } = useCanReportBug();
  useEffect(() => {
    if (status === 'pending') return;
    if (canReport === true) requestReport('note');
    if (router.canGoBack()) router.back();
    else router.replace('/feed');
  }, [router, canReport, status]);
  return null;
}

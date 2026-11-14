import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { requestReport } from '@/features/bug-report/commands';

/**
 * The old address of the bug reporter, kept so links to it still work. The reporter is now the
 * drop on every screen (features/bug-report/ReportHost), so this only opens a new note there and
 * goes straight back to where the link was opened from (the Feed when there is nothing to go back
 * to). For an account that isn't an internal reporter the request is never taken: the reporter
 * isn't loaded, and the server would refuse a report anyway.
 */
export default function ReportBugScreen() {
  const router = useRouter();
  useEffect(() => {
    requestReport('note');
    if (router.canGoBack()) router.back();
    else router.replace('/feed');
  }, [router]);
  return null;
}

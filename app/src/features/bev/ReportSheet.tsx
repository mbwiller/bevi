import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useReportBev } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { SheetOption } from '@/features/lists/SheetOption';
import { errorCopy } from '@/lib/errorCopy';
import { spacing, type, useTheme } from '@/theme';

/**
 * Report reasons. The contract takes a free `reason` string (`bevs.report(id, reason)`) and lists no
 * values, so the app sends these ids; the labels are the interface copy.
 */
export const REPORT_REASONS = [
  { id: 'wrong_info', label: 'Wrong name or brand' },
  { id: 'wrong_category', label: 'Wrong category' },
  { id: 'bad_photo', label: 'Bad or missing photo' },
  { id: 'duplicate', label: 'Duplicate of another Bev' },
  { id: 'not_a_drink', label: 'Not a drink' },
  { id: 'other', label: 'Something else' },
] as const;

/** Report Bev (§6.19): pick a reason, submit, then a thank-you. */
export function ReportSheet({ bevId, name, open, onClose }: { bevId: string; name: string; open: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const report = useReportBev();

  useEffect(() => {
    if (!open) return;
    setReason(null);
    report.reset();
  }, [open]);

  return (
    <Sheet open={open} title={report.isSuccess ? 'Thanks for the report' : `Report ${name}`} snap={90} onClose={onClose}>
      {report.isSuccess ? (
        <View style={styles.pad}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>We'll take a look and fix it if something's off.</Text>
          <Button variant="primary" block onPress={onClose}>
            Done
          </Button>
        </View>
      ) : (
        <>
          {REPORT_REASONS.map((r) => (
            <SheetOption key={r.id} label={r.label} selected={reason === r.id} onPress={() => setReason(r.id)} />
          ))}
          <View style={styles.pad}>
            {report.error ? (
              <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
                {errorCopy(report.error).message}
              </Text>
            ) : null}
            <Button
              variant="primary"
              block
              disabled={!reason}
              loading={report.isPending}
              onPress={() => reason && report.mutate({ bevId, reason })}
            >
              Send report
            </Button>
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, gap: spacing.lg },
});

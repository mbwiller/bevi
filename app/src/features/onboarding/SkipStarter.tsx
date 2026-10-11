import { StyleSheet, View } from 'react-native';

import { useUpdateMe } from '@/api/hooks';
import { Button } from '@/components/Button';
import { FormError } from '@/features/auth/AuthScreen';
import { formErrorMessage } from '@/features/auth/formError';
import { useSession } from '@/state/session';
import { spacing } from '@/theme';

/**
 * TODO(starter): TEMPORARY. Finishes onboarding without the starter ranking so the flow can be
 * completed end to end. Remove when the starter screen (§6.3) lands; it sets `onboarded` itself.
 */
export function SkipStarter() {
  const updateMe = useUpdateMe();
  const completeOnboarding = useSession((s) => s.completeOnboarding);
  const skip = () => updateMe.mutate({ onboarded: true }, { onSuccess: (profile) => completeOnboarding(profile) });
  return (
    <View style={styles.wrap}>
      <FormError>{updateMe.error ? formErrorMessage(updateMe.error) : null}</FormError>
      <Button variant="outlined" block loading={updateMe.isPending || updateMe.isSuccess} onPress={skip}>
        Skip for now
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.sm } });

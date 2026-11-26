import { EmptyState } from '@/components/EmptyState';

/**
 * A person the server answers 'not_found' for: deleted, or across a block (it reads exactly the
 * same, on purpose: nobody can tell who blocked whom). Shared by their profile, followers and following.
 */
export function PersonNotFound({ onBack }: { onBack: () => void }) {
  return (
    <EmptyState
      icon="user"
      title="This person isn't on Bevi anymore"
      body="Their account may have been deleted."
      action="Go back"
      onAction={onBack}
    />
  );
}

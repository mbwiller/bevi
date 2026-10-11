import { Placeholder, PlaceholderLinks } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function AddBevScreen() {
  const back = useBack();
  return (
    <Placeholder
      title="Add Bev"
      header={{ wordmark: true, actions: [{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }] }}
    >
      <PlaceholderLinks links={[{ label: 'Create a new Bev', href: '/add/new' }]} />
    </Placeholder>
  );
}

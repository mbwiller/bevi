import { Placeholder, PlaceholderLinks } from '@/dev/Placeholder';

export default function AddBevScreen() {
  return (
    <Placeholder title="Add Bev" header={{ wordmark: true }}>
      <PlaceholderLinks links={[{ label: 'Create a new Bev', href: '/add/new' }]} />
    </Placeholder>
  );
}

import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function NewBevScreen() {
  const back = useBack();
  return <Placeholder title="New Bev" header={{ title: 'New Bev', actions: [{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }] }} />;
}

import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function ImageScreen() {
  const back = useBack();
  return <Placeholder title="Image" header={{ actions: [{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }] }} />;
}

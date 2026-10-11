import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function RankScreen() {
  const back = useBack();
  return <Placeholder title="Rank this Bev" header={{ actions: [{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }] }} />;
}

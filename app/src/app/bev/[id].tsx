import { Placeholder } from '@/dev/Placeholder';
import { useBack } from '@/lib/useBack';

export default function BevDetailScreen() {
  const back = useBack();
  return <Placeholder title="Bev" header={{ onBack: back }} />;
}

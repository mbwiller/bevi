import { useLocalSearchParams } from 'expo-router';

import { RankFlow } from '@/features/ranking/RankFlow';

/** Full-screen ranking modal (DEVELOPMENT-MATT §6.9). `?mode=rerank` moves an existing ranking. */
export default function RankScreen() {
  const { bevId, mode } = useLocalSearchParams<{ bevId: string; mode?: string }>();
  return <RankFlow key={bevId} bevId={bevId} rerank={mode === 'rerank'} />;
}

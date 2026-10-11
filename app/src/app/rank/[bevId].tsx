import { useLocalSearchParams } from 'expo-router';

import { RankFlow } from '@/features/ranking/RankFlow';

/**
 * Full-screen ranking modal (DEVELOPMENT-MATT §6.9). `?mode=rerank` moves an existing ranking;
 * `?entry=search` (a tapped search result) opens the Bev's detail instead when it's already ranked.
 */
export default function RankScreen() {
  const { bevId, mode, entry } = useLocalSearchParams<{ bevId: string; mode?: string; entry?: string }>();
  return <RankFlow key={bevId} bevId={bevId} rerank={mode === 'rerank'} detailIfRanked={entry === 'search'} />;
}

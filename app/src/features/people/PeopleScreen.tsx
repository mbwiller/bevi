import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useUser } from '@/api/hooks';
import { Header } from '@/components/Header';
import { useBack } from '@/lib/useBack';
import { useTheme } from '@/theme';

import { PeopleList, type PeopleListProps, type PeopleQuery } from './PeopleList';

export interface PeopleScreenProps {
  /** Whose followers or following. */
  userId: string | undefined;
  title: string;
  query: PeopleQuery;
  which: 'followers' | 'following';
}

/** A pushed screen with a back header over a searchable PeopleList (followers / following, §6.15). */
export function PeopleScreen({ userId, title, query, which }: PeopleScreenProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const me = useMe();
  const self = !!me.data && me.data.id === userId;
  const owner = useUser(self || !me.data ? undefined : userId);
  const first = owner.data ? owner.data.displayName.split(' ')[0] || `@${owner.data.handle}` : 'They';

  const empty: PeopleListProps['empty'] =
    which === 'followers'
      ? {
          icon: 'users',
          title: 'No followers yet',
          body: self ? "When friends follow you, they'll show up here." : `People who follow ${first} will show up here.`,
        }
      : self
        ? {
            icon: 'user-plus',
            title: "You're not following anyone yet",
            body: 'Follow friends to see their Bevs.',
            action: 'Find people',
            onAction: () => router.push({ pathname: '/add', params: { tab: 'people' } }),
          }
        : { icon: 'user-plus', title: `${first} isn't following anyone yet` };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={title} onBack={back} />
      <View style={styles.body}>
        <PeopleList query={query} meId={me.data?.id} empty={empty} searchable />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
});

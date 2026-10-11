import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { imageUrlFromParam } from '@/features/bev/imageUrl';
import { useBack } from '@/lib/useBack';
import { spacing, useTheme } from '@/theme';

/** Full-screen image viewer (§6.19): a Bev photo or nutrition label, fitted to the screen, with Close. */
export default function ImageScreen() {
  const { colors } = useTheme();
  const back = useBack();
  const { url: param } = useLocalSearchParams<{ url: string }>();
  const url = imageUrlFromParam(param);
  const [failed, setFailed] = useState(false);
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }]} />
      <View style={styles.body}>
        {url && !failed ? (
          <Image
            source={{ uri: url }}
            style={styles.image}
            contentFit="contain"
            accessibilityLabel="Full-screen image"
            onError={() => setFailed(true)}
          />
        ) : (
          <ErrorState title="Image not available" message="Go back and try again." icon="image" />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: spacing.gutter },
  image: { flex: 1 },
});

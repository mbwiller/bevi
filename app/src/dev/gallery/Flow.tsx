import { BUCKET_ORDER, type Bucket } from '@bevi/ranking';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BevArt } from '@/components/BevArt';
import { BevGlow } from '@/components/BevGlow';
import { BucketButton } from '@/components/BucketButton';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { ProgressDots } from '@/components/ProgressDots';
import { Sheet } from '@/components/Sheet';
import { spacing, type, useTheme } from '@/theme';

import { Group, Row, Specimen } from './parts';
import type { GallerySection } from './types';

// Sample data: the design system's ScreenGutCheck Bev (LaCroix Pamplemousse).
const SAMPLE_ART = { kind: 'can', color: '#f4a7b9', accent: '#ffffff' } as const;
const SORTS = ['Score', 'Recently ranked', 'Name', 'Price'];

/** The gut check's bucket spacing in the design system (BucketButton README: "14pt apart"). */
const BUCKET_GAP = 14;
const ART = 200;
const ROW = 48;

function GutCheck({ material, initial }: { material: 'glass' | 'tint'; initial: Bucket | null }) {
  const { colors } = useTheme();
  const [chosen, setChosen] = useState<Bucket | null>(initial);
  return (
    <BevGlow color={SAMPLE_ART.color} style={styles.glow}>
      <View style={styles.hero}>
        <View style={styles.art}>
          <BevArt {...SAMPLE_ART} title="LaCroix Pamplemousse" />
        </View>
        <Text style={[type.screenTitle, { color: colors.text }]}>LaCroix Pamplemousse</Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>LaCroix</Text>
      </View>
      <Text style={[type.displayDrop, styles.question, { color: colors.text }]}>How was it?</Text>
      <View style={styles.buckets}>
        {BUCKET_ORDER.map((b) => (
          <BucketButton key={b} bucket={b} material={material} selected={chosen === b} onPress={() => setChosen(chosen === b ? null : b)} />
        ))}
      </View>
      <Text style={[type.caption, styles.hint, { color: colors.textSecondary }]}>
        Next, you&apos;ll compare it with Bevs you&apos;ve already ranked.
      </Text>
    </BevGlow>
  );
}

function SheetDemo() {
  const { colors } = useTheme();
  const [snap, setSnap] = useState<40 | 90 | null>(null);
  const [sort, setSort] = useState(SORTS[0]);
  return (
    <>
      <Row align="flex-start">
        <Button onPress={() => setSnap(40)}>Open at 40%</Button>
        <Button onPress={() => setSnap(90)}>Open at 90%</Button>
      </Row>
      <Text style={[type.caption, { color: colors.textSecondary }]}>Sort: {sort}</Text>
      <Sheet open={snap != null} snap={snap ?? 40} title="Sort by" onClose={() => setSnap(null)}>
        {SORTS.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityLabel={s}
            aria-pressed={s === sort}
            onPress={() => {
              setSort(s);
              setSnap(null);
            }}
            style={[styles.option, { borderBottomColor: colors.border }]}
          >
            <Text style={[type.bodyLarge, { color: colors.text }]}>{s}</Text>
            {s === sort ? <Icon name="check" size={22} strokeWidth={2} color={colors.primary} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

function Flow() {
  return (
    <View>
      <Group title="BucketButton · glass on BevGlow">
        <GutCheck material="glass" initial="LOVED" />
      </Group>
      <Group title="BucketButton · tint">
        <GutCheck material="tint" initial="FINE" />
      </Group>
      <Group title="BevGlow · no colour (primary)">
        <BevGlow style={styles.bareGlow} />
      </Group>
      <Group title="ProgressDots">
        <Row align="flex-start">
          <Specimen label="5 · first">
            <ProgressDots total={5} current={0} />
          </Specimen>
          <Specimen label="4 · second">
            <ProgressDots total={4} current={1} />
          </Specimen>
          <Specimen label="5 · last">
            <ProgressDots total={5} current={4} />
          </Specimen>
          <Specimen label="1">
            <ProgressDots total={1} current={0} />
          </Specimen>
        </Row>
      </Group>
      <Group title="Sheet">
        <SheetDemo />
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.xxl, maxWidth: 430, alignSelf: 'stretch' },
  hero: { alignItems: 'center', gap: spacing.xs },
  art: { width: ART, height: ART, marginBottom: spacing.md },
  question: { textAlign: 'center', marginVertical: spacing.xxl },
  buckets: { gap: BUCKET_GAP },
  hint: { textAlign: 'center', marginTop: spacing.lg },
  bareGlow: { height: 160, maxWidth: 430 },
  option: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
});

export const flow: GallerySection = { id: 'flow', title: 'Ranking flow', Component: Flow };

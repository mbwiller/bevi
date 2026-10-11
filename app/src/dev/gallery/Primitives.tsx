import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AvatarStack } from '@/components/AvatarStack';
import { BevArt, bevArtForCategory, bevArtKinds } from '@/components/BevArt';
import { BevImage } from '@/components/BevImage';
import { Button } from '@/components/Button';
import { Icon, iconNames } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { PriceTier } from '@/components/PriceTier';
import { ScoreBubble } from '@/components/ScoreBubble';
import { CATEGORIES } from '@/lib/categories';
import { size, spacing, type, useTheme } from '@/theme';

import { Group, Row, Specimen } from './parts';
import type { GallerySection } from './types';

/** A real image served by the app itself (public/), standing in for a photo URL. */
const PHOTO = '/icon-192.png';

const FRIENDS = [
  { name: 'Jack Torres' },
  { name: 'Priya Nair' },
  { name: 'Sam Okafor', src: PHOTO },
  { name: 'Lena Park' },
  { name: 'Arjun Cheema' },
  { name: 'Diego Ruiz' },
];

const ART_SIZE = 72;

function Primitives() {
  const { colors } = useTheme();
  const [presses, setPresses] = useState(0);
  const [active, setActive] = useState(true);
  const press = () => setPresses((n) => n + 1);
  const meta = [type.body, { color: colors.textSecondary }];

  return (
    <View>
      <Text style={[type.caption, { color: colors.textSecondary }]}>Presses: {presses}</Text>

      <Group title="Icon">
        <Row align="flex-start">
          <Specimen label="28 · 1.6">
            <Icon name="bookmark" size={28} strokeWidth={1.6} />
          </Specimen>
          <Specimen label="filled · primary">
            <Icon name="bookmark" size={28} strokeWidth={1.6} filled color={colors.primary} />
          </Specimen>
          <Specimen label="24">
            <Icon name="trophy" size={24} />
          </Specimen>
          <Specimen label="16 · 2 · secondary">
            <Icon name="chevron-right" size={16} strokeWidth={2} color={colors.textSecondary} />
          </Specimen>
          <Specimen label="filled heart">
            <Icon name="heart" size={28} strokeWidth={1.6} filled color={colors.primary} title="Recommended" />
          </Specimen>
        </Row>
        <View style={styles.grid}>
          {iconNames.map((n) => (
            <View key={n} style={styles.cell}>
              <Icon name={n} size={size.icon} strokeWidth={1.6} />
              <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                {n}
              </Text>
            </View>
          ))}
        </View>
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]}>Categories</Text>
        <View style={styles.grid}>
          {CATEGORIES.map((c) => (
            <View key={c.id} style={styles.cell}>
              <Icon name={c.icon} size={24} />
              <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                {c.label}
                {c.isAlcoholic ? ' (21+)' : ''}
              </Text>
            </View>
          ))}
        </View>
      </Group>

      <Group title="BevArt">
        <Row>
          {bevArtKinds.map((k) => (
            <Specimen key={k} label={k}>
              <View style={{ width: ART_SIZE, height: ART_SIZE }}>
                <BevArt kind={k} />
              </View>
            </Specimen>
          ))}
        </Row>
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]}>bevArtForCategory</Text>
        <Row>
          {CATEGORIES.map((c) => (
            <Specimen key={c.id} label={c.label}>
              <BevImage size={56} art={bevArtForCategory(c.id)} alt={c.label} />
            </Specimen>
          ))}
        </Row>
      </Group>

      <Group title="BevImage">
        <Row>
          <Specimen label="40">
            <BevImage size={40} art={bevArtForCategory('soda')} alt="Sprite" />
          </Specimen>
          <Specimen label="56">
            <BevImage size={56} art={bevArtForCategory('sparkling_water')} alt="Topo Chico" />
          </Specimen>
          <Specimen label="96">
            <BevImage size={96} art={bevArtForCategory('boba')} alt="Brown Sugar Boba" />
          </Specimen>
          <Specimen label="155">
            <BevImage size={155} art={bevArtForCategory('diet_soda')} alt="Diet Coke" />
          </Specimen>
          <Specimen label="src (photo)">
            <BevImage size={96} src={PHOTO} alt="Photo" />
          </Specimen>
          <Specimen label="processing">
            <BevImage size={96} art={bevArtForCategory('other')} status="processing" alt="Horchata" />
          </Specimen>
          <Specimen label="processing · src">
            <BevImage size={96} src={PHOTO} status="processing" alt="Photo" />
          </Specimen>
          <Specimen label="loading">
            <BevImage size={96} status="loading" />
          </Specimen>
          <Specimen label="no photo">
            <BevImage size={96} />
          </Specimen>
        </Row>
      </Group>

      <Group title="ScoreBubble">
        <Row>
          <Specimen label="Loved 9.3">
            <ScoreBubble score={9.3} />
          </Specimen>
          <Specimen label="Fine 5.8">
            <ScoreBubble score={5.8} />
          </Specimen>
          <Specimen label="Didn't like 2.1">
            <ScoreBubble score={2.1} />
          </Specimen>
          <Specimen label="6.95 → 7.0">
            <ScoreBubble score={6.95} />
          </Specimen>
          <Specimen label="3.95 → 4.0">
            <ScoreBubble score={3.95} />
          </Specimen>
          <Specimen label="count 198">
            <ScoreBubble score={8.3} count={198} />
          </Specimen>
          <Specimen label="count 5120">
            <ScoreBubble score={7.3} count={5120} />
          </Specimen>
          <Specimen label="predicted">
            <ScoreBubble score={8.2} variant="predicted" />
          </Specimen>
          <Specimen label="locked">
            <ScoreBubble variant="locked" />
          </Specimen>
          <Specimen label="null">
            <ScoreBubble score={null} />
          </Specimen>
          <Specimen label="bucket FINE, 7.4">
            <ScoreBubble score={7.4} bucket="FINE" />
          </Specimen>
        </Row>
        <Row>
          <Specimen label="56 · count">
            <ScoreBubble score={8.9} size={56} count={31} />
          </Specimen>
          <Specimen label="56 predicted">
            <ScoreBubble score={7.6} size={56} variant="predicted" />
          </Specimen>
          <Specimen label="56 mid">
            <ScoreBubble score={4.0} size={56} />
          </Specimen>
          <Specimen label="56 low">
            <ScoreBubble score={1.2} size={56} />
          </Specimen>
          <Specimen label="56 locked">
            <ScoreBubble size={56} variant="locked" />
          </Specimen>
        </Row>
      </Group>

      <Group title="PriceTier">
        <Row align="flex-start">
          {([1, 2, 3, 4] as const).map((t) => (
            <Specimen key={t} label={`tier ${t}`}>
              <Text style={meta}>
                <PriceTier tier={t} /> • Soda
              </Text>
            </Specimen>
          ))}
          <Specimen label="estimated">
            <Text style={meta}>
              <PriceTier tier={2} estimated /> • Other
            </Text>
          </Specimen>
        </Row>
      </Group>

      <Group title="Avatar">
        <Row>
          <Specimen label="32">
            <Avatar name="Matt Willer" size={32} />
          </Specimen>
          <Specimen label="44">
            <Avatar name="Arjun Cheema" size={44} />
          </Specimen>
          <Specimen label="60">
            <Avatar name="Priya Nair" size={60} />
          </Specimen>
          <Specimen label="100">
            <Avatar name="Matt Willer" size={100} />
          </Specimen>
          <Specimen label="photo 60">
            <Avatar name="Sam Okafor" src={PHOTO} size={60} />
          </Specimen>
          <Specimen label="ring 44">
            <Avatar name="Lena Park" size={44} ring />
          </Specimen>
        </Row>
      </Group>

      <Group title="AvatarStack">
        <Row align="flex-start">
          <Specimen label="6 friends, max 4">
            <AvatarStack people={FRIENDS} />
          </Specimen>
          <Specimen label="two friends">
            <AvatarStack people={FRIENDS.slice(0, 2)} />
          </Specimen>
          <Specimen label="44, max 3, overlap 12">
            <AvatarStack people={FRIENDS} size={44} max={3} overlap={spacing.md} />
          </Specimen>
        </Row>
      </Group>

      <Group title="Pill">
        <Row align="center">
          <Pill variant="filled" icon="camera" onPress={press}>
            Snap it
          </Pill>
          <Pill variant="filled" icon="user-plus" onPress={press}>
            Find people
          </Pill>
          <Pill variant="filled" onPress={press}>
            Follow
          </Pill>
          <Pill onPress={press}>Following</Pill>
          <Pill iconRight="chevron-down" onPress={press}>
            Category
          </Pill>
          <Pill active={active} onPress={() => setActive((a) => !a)}>
            Not tried
          </Pill>
          <Pill onPress={press}>Too close to call</Pill>
          <Pill disabled onPress={press}>
            Disabled
          </Pill>
        </Row>
      </Group>

      <Group title="Button">
        <Row align="center">
          <Button onPress={press}>Edit profile</Button>
          <Button onPress={press}>Share profile</Button>
          <Button icon="chevron-down" accessibilityLabel="More" onPress={press} />
          <Button variant="ghost" onPress={press}>
            Skip
          </Button>
          <Button disabled onPress={press}>
            Disabled
          </Button>
        </Row>
        <Button variant="primary" block onPress={press}>
          Rank it
        </Button>
        <Row align="center">
          <Button variant="primary" loading>
            Rank it
          </Button>
          <Button variant="primary" icon="circle-plus" onPress={press}>
            Add a new Bev
          </Button>
          <Button variant="outlined" size="lg" onPress={press}>
            Outlined lg
          </Button>
          <Button variant="primary" size="md" onPress={press}>
            Primary md
          </Button>
          <Button loading>Saving</Button>
        </Row>
      </Group>

      <Group title="IconButton">
        <Row align="center">
          <Specimen label="plain">
            <IconButton icon="user-plus" label="Find people" onPress={press} />
          </Specimen>
          <Specimen label="settings">
            <IconButton icon="settings" label="Settings" onPress={press} />
          </Specimen>
          <Specimen label="share">
            <IconButton icon="share" label="Share" onPress={press} />
          </Specimen>
          <Specimen label="filled close">
            <IconButton icon="x" label="Close" variant="filled" onPress={press} />
          </Specimen>
          <Specimen label="badge">
            <IconButton icon="menu" label="Menu" badge={4} onPress={press} />
          </Specimen>
          <Specimen label="badge 99+">
            <IconButton icon="newspaper" label="Activity" badge="99+" onPress={press} />
          </Specimen>
          <Specimen label="24">
            <IconButton icon="search" label="Search" size={24} onPress={press} />
          </Specimen>
        </Row>
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { width: 104, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
});

export const primitives: GallerySection = { id: 'primitives', title: 'Primitives', Component: Primitives };

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FilterPill } from '@/components/FilterPill';
import { Header } from '@/components/Header';
import { ListScopeDropdown } from '@/components/ListScopeDropdown';
import { PriceTierPicker } from '@/components/PriceTierPicker';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { SortToggle } from '@/components/SortToggle';
import { TabBar, type TabId } from '@/components/TabBar';
import { TextField } from '@/components/TextField';
import { priceTierText } from '@/components/PriceTier';
import { spacing, type, useTheme } from '@/theme';

import { Group, Row, Specimen } from './parts';
import type { GallerySection } from './types';

const ME = { name: 'Matt Willer' };
const SORTS = ['Score', 'Recent', 'Name', 'Predicted'];
const TAB_IDS: TabId[] = ['feed', 'lists', 'add', 'leaderboard', 'profile'];

/** A full-width specimen (headers, tabs, bars) on a hairline frame, the way they sit on a screen. */
function Frame({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.frameWrap}>
      <View style={[styles.frame, { borderColor: colors.border }]}>{children}</View>
      <Text style={[type.caption, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function Controls() {
  const { colors } = useTheme();
  const [last, setLast] = useState('—');
  const [query, setQuery] = useState('');
  const [addQuery, setAddQuery] = useState('horch');
  const [handle, setHandle] = useState('mbwiller');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<{ tier: 1 | 2 | 3 | 4 | null; est: boolean }>({ tier: 2, est: false });
  const [list, setList] = useState('recs');
  const [profileTab, setProfileTab] = useState('activity');
  const [addTab, setAddTab] = useState('bevs');
  const [sort, setSort] = useState(0);
  const [filters, setFilters] = useState(3);
  const [tab, setTab] = useState<TabId>('feed');
  const did = (what: string) => () => setLast(what);
  const meta = [type.caption, { color: colors.textSecondary }];

  return (
    <View>
      <Text style={meta}>Last action: {last}</Text>

      <Group title="FilterPill">
        <Row align="center">
          <Specimen label={`count ${filters} (tap to add)`}>
            <FilterPill count={filters} onPress={() => setFilters((n) => (n + 1) % 5)} />
          </Specimen>
          <Specimen label="count 0">
            <FilterPill count={0} onPress={did('Filters')} />
          </Specimen>
          <Specimen label="facet · chevron">
            <FilterPill label="Bucket" chevron icon={null} onPress={did('Bucket filter')} />
          </Specimen>
          <Specimen label="facet · active">
            <FilterPill label="Price" chevron icon={null} count={1} onPress={did('Price filter')} />
          </Specimen>
        </Row>
      </Group>

      <Group title="SortToggle">
        <Frame label="label cycles · with search">
          <SortToggle label={SORTS[sort]} onPress={() => setSort((n) => (n + 1) % SORTS.length)} onSearch={did('Search this list')} />
        </Frame>
        <Frame label="onSearch={false}">
          <SortToggle label="Predicted" onSearch={false} onPress={did('Sort')} />
        </Frame>
      </Group>

      <Group title="SearchBar">
        <SearchBar placeholder="Search a Bev or a person" value={query} onChange={setQuery} onClear={did('Cleared')} onSubmit={(v) => setLast(`Search "${v}"`)} id="feed-search" />
        <Text style={meta}>filled · typed: “{query}”</Text>
        <SearchBar variant="outlined" placeholder="Search a Bev, brand or flavor" value={addQuery} onChange={setAddQuery} id="add-search" />
        <Text style={meta}>outlined · with text (clear button)</Text>
        <SearchBar placeholder="Search by name or @handle" />
        <Text style={meta}>uncontrolled</Text>
      </Group>

      <Group title="TextField">
        <View style={styles.col}>
          <TextField label="Display name" defaultValue="Matt Willer" autoComplete="name" />
          <TextField label="Handle" prefix="@" value={handle} onChange={setHandle} hint="Lowercase, 3–20 characters." autoComplete="username" autoCapitalize="none" />
          <TextField label="Handle" prefix="@" defaultValue="arjun" error="That handle is taken." />
          <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" hint={`${password.length} characters`} onSubmit={() => setLast('Sign in')} />
          <TextField placeholder="Invite code" autoCapitalize="characters" />
        </View>
      </Group>

      <Group title="PriceTierPicker">
        <View style={styles.col}>
          <PriceTierPicker value={tier.tier} estimated={tier.est} onChange={(t, est) => setTier({ tier: t, est })} />
          <Text style={meta}>
            priceTier: {tier.tier == null ? 'null' : priceTierText(tier.tier)} · priceEstimated: {String(tier.est)}
          </Text>
          <PriceTierPicker />
          <Text style={meta}>uncontrolled, nothing chosen</Text>
        </View>
      </Group>

      <Group title="SegmentedTabs">
        <Frame label={`underline-text · ${list}`}>
          <SegmentedTabs
            tabs={[
              { id: 'bevd', label: "Bev'd" },
              { id: 'want', label: 'Want to Try' },
              { id: 'recs', label: 'Recommended' },
            ]}
            value={list}
            onChange={setList}
          />
        </Frame>
        <Frame label={`underline-icon · accent text · ${profileTab}`}>
          <SegmentedTabs
            variant="underline-icon"
            tabs={[
              { id: 'activity', label: 'Activity', icon: 'file-text' },
              { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' },
            ]}
            value={profileTab}
            onChange={setProfileTab}
          />
        </Frame>
        <Frame label={`underline-icon · accent primary · ${addTab}`}>
          <SegmentedTabs
            variant="underline-icon"
            accent="primary"
            tabs={[
              { id: 'bevs', label: 'Bevs', icon: 'cup-soda' },
              { id: 'people', label: 'People', icon: 'users' },
            ]}
            value={addTab}
            onChange={setAddTab}
          />
        </Frame>
        <Frame label="underline-text · chevron · uncontrolled">
          <SegmentedTabs
            tabs={[
              { id: 'bevs', label: 'Bevs' },
              { id: 'people', label: 'People' },
              { id: 'region', label: 'Everywhere', chevron: true },
            ]}
          />
        </Frame>
      </Group>

      <Group title="SectionHeader">
        <Frame label="with action">
          <SectionHeader title="Featured Bevs" action="See all" onAction={did('See all')} />
        </Frame>
        <Frame label="title only">
          <SectionHeader title="Your feed" />
        </Frame>
      </Group>

      <Group title="ListScopeDropdown">
        <Row align="center">
          <Specimen label="All">
            <ListScopeDropdown label="All" onPress={did('Scope sheet')} />
          </Specimen>
          <Specimen label="category">
            <ListScopeDropdown label="Sparkling water" onPress={did('Scope sheet')} />
          </Specimen>
        </Row>
      </Group>

      <Group title="Header">
        <Frame label="wordmark · action">
          <Header wordmark actions={[{ icon: 'user-plus', label: 'Find people', onPress: did('Find people') }]} />
        </Frame>
        <Frame label="title · two actions · badge">
          <Header
            title="Matt Willer"
            actions={[
              { icon: 'share', label: 'Share profile', onPress: did('Share profile') },
              { icon: 'settings', label: 'Settings', badge: 2, onPress: did('Settings') },
            ]}
          />
        </Frame>
        <Frame label="centered">
          <Header centered title="Your lists" actions={[{ icon: 'share', label: 'Share', onPress: did('Share') }]} />
        </Frame>
        <Frame label="wordmark · filled close">
          <Header wordmark actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: did('Close') }]} />
        </Frame>
        <Frame label="onBack · long title">
          <Header
            title="LaCroix Pamplemousse Sparkling Water"
            onBack={did('Back')}
            actions={[{ icon: 'ellipsis', label: 'More', onPress: did('More') }]}
          />
        </Frame>
      </Group>

      <Group title="TabBar">
        <Frame label={`interactive · ${tab}`}>
          <TabBar active={tab} user={ME} onChange={setTab} safeArea={false} />
        </Frame>
        {TAB_IDS.map((id) => (
          <Frame key={id} label={`active ${id}`}>
            <TabBar active={id} user={ME} safeArea={false} onChange={(t) => setLast(`Tab ${t}`)} />
          </Frame>
        ))}
        <Frame label="no user · safeArea (bottom inset)">
          <TabBar active="profile" onChange={(t) => setLast(`Tab ${t}`)} />
        </Frame>
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.lg, maxWidth: 393, alignSelf: 'stretch' },
  frameWrap: { gap: spacing.sm, maxWidth: 393, alignSelf: 'stretch' },
  frame: { borderWidth: 1 },
});

export const controls: GallerySection = { id: 'controls', title: 'Controls', Component: Controls };

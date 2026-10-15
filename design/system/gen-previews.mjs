// Writes project/components/<Name>/preview.html for every component and screen showcase.
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

const BASE_CSS = `
  body { margin: 0; background: var(--surface); color: var(--text); font-family: var(--font-sans); }
  .pv { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 20px 16px; }
  .pv-col { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
  .pv-stack { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .pv-label { font-size: 12px; line-height: 16px; color: var(--textSecondary); }
  .pv-narrow { max-width: 393px; }
  .pv-frame { position: relative; width: 393px; max-width: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
`;

const SAMPLES = `
  var BEVS = {
    dietCoke: { name: 'Diet Coke', brand: 'Coca-Cola', category: 'diet_soda', priceTier: 1, art: { kind: 'can', color: '#d6d6db', accent: '#c8102e' } },
    mexicanCoke: { name: 'Mexican Coke', brand: 'Coca-Cola', category: 'soda', priceTier: 2, art: { kind: 'bottle', color: '#3b1d12', accent: '#e03a3e' } },
    topo: { name: 'Topo Chico', brand: 'Topo Chico', category: 'sparkling_water', priceTier: 1, art: { kind: 'bottle', color: '#a9d8c9', accent: '#f2c94c' } },
    pamplemousse: { name: 'LaCroix Pamplemousse', brand: 'LaCroix', flavor: 'Pamplemousse', category: 'sparkling_water', priceTier: 1, art: { kind: 'can', color: '#f4a7b9', accent: '#ffffff' } },
    redBull: { name: 'Red Bull', brand: 'Red Bull', category: 'energy', priceTier: 2, art: { kind: 'slimCan', color: '#2d4fa1', accent: '#c0c4cc' } },
    brownSugar: { name: 'Brown Sugar Boba', brand: 'Tiger Sugar', category: 'boba', priceTier: 2, art: { kind: 'boba', color: '#c9a27e', accent: '#7a4a2a' } },
    horchata: { name: 'Horchata', brand: 'Tacos El Gordo', category: 'other', priceTier: 2, priceEstimated: true, art: { kind: 'icedCup', color: '#efe4d0', accent: '#b07a45' } },
    coldBrew: { name: 'Cold Brew', brand: 'Blue Bottle', category: 'coffee', priceTier: 2, art: { kind: 'icedCup', color: '#4a2c1d', accent: '#3c7dd9' } },
    sprite: { name: 'Sprite', brand: 'Coca-Cola', category: 'soda', priceTier: 1, art: { kind: 'can', color: '#1f8f4e', accent: '#f2d230' } },
    gatorade: { name: 'Gatorade Cool Blue', brand: 'Gatorade', category: 'sports', priceTier: 1, art: { kind: 'waterBottle', color: '#3aa0e0', accent: '#f26b1d' } },
    oj: { name: 'Orange Juice', brand: 'Tropicana', category: 'juice', priceTier: 1, art: { kind: 'carton', color: '#f6a623', accent: '#2f9e44' } },
    poppi: { name: 'Strawberry Lemon', brand: 'Poppi', category: 'diet_soda', priceTier: 2, art: { kind: 'can', color: '#f7c6cf', accent: '#e8384f' } },
    matcha: { name: 'Iced Matcha Latte', brand: 'Starbucks', category: 'tea', priceTier: 2, art: { kind: 'icedCup', color: '#9cbf6b', accent: '#1e7a46' } },
  };
  var ME = { name: 'Matt Willer', handle: 'mbwiller' };
  var ARJUN = { name: 'Arjun Cheema', handle: 'acheema5' };
  var FRIENDS = [{ name: 'Jack Torres', handle: 'jackt' }, { name: 'Priya Nair', handle: 'priya' }, { name: 'Sam Okafor', handle: 'samo' }, { name: 'Lena Park', handle: 'lenap' }, ARJUN, { name: 'Diego Ruiz', handle: 'dr' }];
`;

const page = (name, { group, height, width, subtitle, isPage }, css, code) => {
  const marker = `<!-- @dsCard${group ? ` group="${group}"` : ''} height=${height}${width ? ` width=${width}` : ''}${subtitle ? ` subtitle="${subtitle}"` : ''}${isPage ? ' page' : ''} -->`;
  return `${marker}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name}</title>
<style>${BASE_CSS}${css || ''}</style>
</head>
<body>
<div id="root"></div>
<script>
  var B = window.Bevi, h = React.createElement, F = React.Fragment;
  function L(text, el) { return h('div', { className: 'pv-stack' }, el, h('span', { className: 'pv-label' }, text)); }
${SAMPLES}
  ReactDOM.createRoot(document.getElementById('root')).render(${code.trim()});
</script>
</body>
</html>
`;
};

const P = {};

// ---------- Brand ----------
P.Wordmark = [{ group: 'Brand', height: 150 }, `.inv { background: var(--tasteCard); border-radius: 16px; padding: 16px 20px; }`, `
h('div', { className: 'pv' },
  L('header · 28pt', h(B.Wordmark, { height: 28 })),
  L('brand · 56pt', h(B.Wordmark, { height: 56 })),
  L('inverse on tasteCard', h('div', { className: 'inv' }, h(B.Wordmark, { height: 40, tone: 'inverse' }))),
  L('mono · currentColor', h('span', { style: { color: 'var(--text)' } }, h(B.Wordmark, { height: 40, tone: 'mono' }))))`];

P.Icon = [{ group: 'Brand', height: 330, subtitle: 'Lucide 0.460.0 subset' }, `.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 4px; padding: 16px; }
.cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 2px; font-size: 10px; line-height: 12px; color: var(--textSecondary); text-align: center; word-break: break-word; }
.cell svg { color: var(--text); }`, `
h('div', { className: 'grid' }, B.iconNames.map(function (n) { return h('div', { key: n, className: 'cell' }, h(B.Icon, { name: n, size: 28, strokeWidth: 1.6 }), n); }))`];

P.BevArt = [{ group: 'Brand', height: 230, subtitle: 'Placeholder cutouts for mockups' }, `.tile { width: 96px; height: 96px; }`, `
h('div', { className: 'pv' }, [
  ['can', BEVS.dietCoke.art], ['slimCan', BEVS.redBull.art], ['bottle', BEVS.mexicanCoke.art], ['waterBottle', BEVS.gatorade.art], ['boba', BEVS.brownSugar.art],
  ['icedCup', BEVS.coldBrew.art], ['mug', {}], ['carton', BEVS.oj.art], ['pint', {}], ['wine', {}]
].map(function (k) { return h(F, { key: k[0] }, L(k[0], h(B.BevImage, { size: 96, art: Object.assign({}, k[1], { kind: k[0] }) }))); }))`];

// ---------- Bev ----------
P.BevImage = [{ group: 'Bev', height: 240 }, '', `
h('div', { className: 'pv', style: { alignItems: 'flex-end' } },
  L('40', h(B.BevImage, { size: 40, art: BEVS.sprite.art, alt: 'Sprite' })),
  L('56', h(B.BevImage, { size: 56, art: BEVS.topo.art, alt: 'Topo Chico' })),
  L('96', h(B.BevImage, { size: 96, art: BEVS.brownSugar.art, alt: 'Brown Sugar Boba' })),
  L('155 · strip, gut check, detail', h(B.BevImage, { size: 155, art: BEVS.dietCoke.art, alt: 'Diet Coke' })),
  L('processing', h(B.BevImage, { size: 96, art: BEVS.horchata.art, status: 'processing', alt: 'Horchata' })),
  L('loading', h(B.BevImage, { size: 96, status: 'loading' })),
  L('no photo', h(B.BevImage, { size: 96 })))`];

P.ScoreBubble = [{ group: 'Bev', height: 140 }, '', `
h('div', { className: 'pv', style: { gap: 28 } },
  L('Loved band', h(B.ScoreBubble, { score: 9.3 })),
  L('Fine band', h(B.ScoreBubble, { score: 5.8 })),
  L("Didn't like", h(B.ScoreBubble, { score: 2.1 })),
  L('predicted', h(B.ScoreBubble, { score: 8.2, variant: 'predicted' })),
  L('locked', h(B.ScoreBubble, { variant: 'locked' })),
  L('56 · detail', h(B.ScoreBubble, { score: 8.9, size: 56 })),
  L('56 predicted', h(B.ScoreBubble, { score: 7.6, size: 56, variant: 'predicted' })))`];

P.PriceTier = [{ group: 'Bev', height: 96 }, `.line { font-size: 15px; line-height: 20px; }`, `
h('div', { className: 'pv', style: { gap: 32 } },
  [1, 2, 3, 4].map(function (t) { return h(F, { key: t }, L('tier ' + t, h('span', { className: 'line' }, h(B.PriceTier, { tier: t }), ' • Soda'))); }),
  L('estimated', h('span', { className: 'line' }, h(B.PriceTier, { tier: 2, estimated: true }), ' • Other')))`];

P.BevRow = [{ group: 'Bev', height: 700, width: 393 }, '', `
h('div', { className: 'pv-narrow' },
  h(B.BevRow, { bev: BEVS.dietCoke, number: 1, score: 9.3, meta: 'Ranked Oct 3' }),
  h(B.BevRow, { bev: BEVS.horchata, number: 2, score: 8.8, meta: 'Ranked Sep 28', saved: false }),
  h(B.BevRow, { bev: BEVS.brownSugar, score: 7.3, count: 5120, saved: true, meta: 'Saved from @acheema5' }),
  h(B.BevRow, { bev: BEVS.poppi, score: 8.2, scoreVariant: 'predicted', meta: 'You love diet sodas' }),
  h(B.BevRow, { bev: BEVS.mexicanCoke, score: 8.7, count: 362, showImage: true }))`];

P.FeaturedCard = [{ group: 'Bev', height: 210 }, `.row { display: flex; gap: 16px; padding: 20px 16px; overflow-x: auto; }`, `
h('div', { className: 'row' },
  h(B.FeaturedCard, { title: 'Brown Sugar Boba', subtitle: 'Boba • $$', art: BEVS.brownSugar.art, tint: '#e9d3bd' }),
  h(B.FeaturedCard, { title: 'Top 10 Sparkling Waters', subtitle: "You've had 3 of 10", art: BEVS.topo.art, tint: '#cfe8e0' }),
  h(B.FeaturedCard, { title: 'Red Bull', subtitle: 'Energy • $$', art: BEVS.redBull.art, tint: '#d8def0' }))`];

// ---------- People ----------
P.Avatar = [{ group: 'People', height: 150 }, '', `
h('div', { className: 'pv', style: { alignItems: 'flex-end' } },
  L('32 · tab bar', h(B.Avatar, { name: ME.name, size: 32 })),
  L('44 · rows', h(B.Avatar, { name: ARJUN.name, size: 44 })),
  L('60 · posts', h(B.Avatar, { name: 'Priya Nair', size: 60 })),
  L('100 · profile', h(B.Avatar, { name: ME.name, size: 100 })))`];

P.AvatarStack = [{ group: 'People', height: 96 }, '', `
h('div', { className: 'pv', style: { gap: 40 } },
  L('Friends who have had it', h(B.AvatarStack, { people: FRIENDS })),
  L('two friends', h(B.AvatarStack, { people: FRIENDS.slice(0, 2) })))`];

P.UserRow = [{ group: 'People', height: 330, width: 393 }, '', `
h('div', { className: 'pv-narrow' },
  h(B.UserRow, { user: ARJUN, meta: '84 Bevs', following: true }),
  h(B.UserRow, { user: FRIENDS[1], meta: '31 Bevs', following: false }),
  h(B.UserRow, { user: FRIENDS[0], rank: 1, meta: '212 pts', streak: 14 }),
  h(B.UserRow, { user: ME, rank: 12, meta: '96 pts', streak: 4, self: true, divider: false }))`];

P.StatCard = [{ group: 'People', height: 130, width: 393 }, `.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px 10px; }`, `
h('div', { className: 'two' },
  h(B.StatCard, { icon: 'trophy', label: 'Rank on Bevi', value: '#12' }),
  h(B.StatCard, { icon: 'flame', label: 'Current Streak', value: '4 days' }))`];

P.ProfileListRow = [{ group: 'People', height: 170, width: 393 }, `.list { padding-top: 12px; border-top: 1px solid var(--border); }`, `
h('div', { className: 'pv-narrow' },
  h(B.ProfileListRow, { icon: 'circle-check', label: "Bev'd", count: 42 }),
  h(B.ProfileListRow, { icon: 'bookmark', iconFilled: true, label: 'Want to Try', count: 7 }),
  h(B.ProfileListRow, { icon: 'heart', label: 'Recommended for you' }))`];

// ---------- Actions ----------
P.Pill = [{ group: 'Actions', height: 120 }, '', `
h('div', { className: 'pv' },
  h(B.Pill, { variant: 'filled', icon: 'camera' }, 'Snap it'),
  h(B.Pill, { variant: 'filled', icon: 'user-plus' }, 'Find people'),
  h(B.Pill, { variant: 'filled' }, 'Follow'),
  h(B.Pill, { variant: 'outlined' }, 'Following'),
  h(B.Pill, { variant: 'outlined', iconRight: 'chevron-down' }, 'Category'),
  h(B.Pill, { variant: 'outlined', active: true }, 'Not tried'),
  h(B.Pill, { variant: 'outlined' }, 'Too close to call'))`];

P.Button = [{ group: 'Actions', height: 200, width: 393 }, `.prof { display: flex; gap: 4px; justify-content: center; } .prof > :nth-child(-n+2) { width: 120px; } .prof > :last-child { width: 34px; padding: 0; }`, `
h('div', { className: 'pv-col' },
  h('div', { className: 'prof' },
    h(B.Button, null, 'Edit profile'), h(B.Button, null, 'Share profile'), h(B.Button, { icon: 'chevron-down', 'aria-label': 'More' })),
  h(B.Button, { variant: 'primary', block: true }, 'Rank it'),
  h('div', { style: { display: 'flex', gap: 12 } }, h(B.Button, { variant: 'primary', loading: true }, 'Rank it'), h(B.Button, { variant: 'ghost', size: 'md' }, 'Skip')))`];

P.IconButton = [{ group: 'Actions', height: 110 }, '', `
h('div', { className: 'pv', style: { gap: 12 } },
  L('plain', h(B.IconButton, { icon: 'user-plus', label: 'Find people' })),
  L('settings', h(B.IconButton, { icon: 'settings', label: 'Settings' })),
  L('share', h(B.IconButton, { icon: 'share', label: 'Share' })),
  L('filled close', h(B.IconButton, { icon: 'x', label: 'Close', variant: 'filled' })),
  L('with badge', h(B.IconButton, { icon: 'menu', label: 'Menu', badge: 4 })))`];

P.FilterPill = [{ group: 'Actions', height: 96, width: 393 }, '', `
h('div', { className: 'pv', style: { gap: 10, flexWrap: 'nowrap', overflow: 'hidden' } },
  h(B.FilterPill, { count: 3 }),
  h(B.FilterPill, { label: 'Bucket', chevron: true, icon: null }),
  h(B.FilterPill, { label: 'Price', chevron: true, icon: null }),
  h(B.FilterPill, { count: 0 }))`];

P.SortToggle = [{ group: 'Actions', height: 80, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { paddingTop: 16 } }, h(B.SortToggle, { label: 'Score', onClick: function () {}, onSearch: function () {} }), h(B.SortToggle, { label: 'Recent', onClick: function () {} }))`];

// ---------- Inputs ----------
P.SearchBar = [{ group: 'Inputs', height: 150, width: 393 }, '', `
h('div', { className: 'pv-col' },
  h(B.SearchBar, { placeholder: 'Search a Bev or a person', id: 'feed-search' }),
  h(B.SearchBar, { variant: 'outlined', placeholder: 'Search a Bev, brand or flavor', value: 'horch', id: 'add-search' }))`];

P.TextField = [{ group: 'Inputs', height: 300, width: 393 }, '', `
h('div', { className: 'pv-col', style: { gap: 18 } },
  h(B.TextField, { label: 'Display name', defaultValue: 'Matt Willer', id: 'f-name' }),
  h(B.TextField, { label: 'Handle', prefix: '@', defaultValue: 'mbwiller', hint: 'Lowercase, 3–20 characters.', id: 'f-handle' }),
  h(B.TextField, { label: 'Handle', prefix: '@', defaultValue: 'arjun', error: 'That handle is taken.', id: 'f-taken' }))`];

P.PriceTierPicker = [{ group: 'Inputs', height: 140, width: 393 }, '', `
h('div', { className: 'pv-col' }, h(B.PriceTierPicker, { value: 2 }))`];

// ---------- Navigation ----------
P.Header = [{ group: 'Navigation', height: 260, width: 393 }, `.hd { border-bottom: 1px solid var(--border); }`, `
h('div', { className: 'pv-narrow' },
  h('div', { className: 'hd' }, h(B.Header, { wordmark: true, actions: [{ icon: 'user-plus', label: 'Find people' }] })),
  h('div', { className: 'hd' }, h(B.Header, { title: 'Matt Willer', actions: [{ icon: 'share', label: 'Share profile' }, { icon: 'settings', label: 'Settings' }] })),
  h('div', { className: 'hd' }, h(B.Header, { centered: true, title: 'Your lists', actions: [{ icon: 'share', label: 'Share' }] })),
  h('div', { className: 'hd' }, h(B.Header, { wordmark: true, actions: [{ icon: 'x', label: 'Close', variant: 'filled' }] })),
  h(B.Header, { title: 'Diet Coke', onBack: function () {}, actions: [{ icon: 'ellipsis', label: 'More' }] }))`];

P.SectionHeader = [{ group: 'Navigation', height: 110, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { paddingTop: 12 } }, h(B.SectionHeader, { title: 'Featured Bevs', action: 'See all' }), h(B.SectionHeader, { title: 'Your feed' }))`];

P.ListScopeDropdown = [{ group: 'Navigation', height: 80 }, '', `
h('div', { className: 'pv', style: { gap: 40 } }, h(B.ListScopeDropdown, { label: 'All' }), h(B.ListScopeDropdown, { label: 'Sparkling water' }))`];

P.SegmentedTabs = [{ group: 'Navigation', height: 200, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 12 } },
  h(B.SegmentedTabs, { tabs: [{ id: 'bevd', label: "Bev'd" }, { id: 'want', label: 'Want to Try' }, { id: 'recs', label: 'Recommended' }], value: 'recs' }),
  h(B.SegmentedTabs, { variant: 'underline-icon', tabs: [{ id: 'activity', label: 'Activity', icon: 'file-text' }, { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' }], value: 'activity' }),
  h(B.SegmentedTabs, { variant: 'underline-icon', accent: 'primary', tabs: [{ id: 'bevs', label: 'Bevs', icon: 'cup-soda' }, { id: 'people', label: 'People', icon: 'users' }], value: 'bevs' }))`];

P.TabBar = [{ group: 'Navigation', height: 210, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 } },
  h(B.TabBar, { active: 'feed', user: ME, safeArea: false }),
  h(B.TabBar, { active: 'profile', user: ME }))`];

// ---------- Feed ----------
P.FeedPost = [{ group: 'Feed', height: 720, width: 393 }, '', `
h('div', { className: 'pv-narrow' },
  h(B.FeedPost, { actor: ARJUN, bev: BEVS.horchata, score: 9.5, time: '5 hours ago',
    note: "went back with my mom and she pulled out a sleeper: the cinnamon is way stronger than the dining hall one and it's not too sweet. honestly the best thing on this whole block, and it costs less than a cold brew. getting two next time" }),
  h(B.FeedPost, { actor: FRIENDS[0], verb: 'saved', bev: BEVS.brownSugar, saved: true, time: 'Wednesday' }))`];

// ---------- Ranking ----------
P.BucketButton = [{ group: 'Ranking', height: 560, width: 393, subtitle: 'Tap one to pour' }, `.gc { display: flex; flex-direction: column; gap: 14px; padding: 6px 16px 24px; }
.mat { margin: 0; padding: 20px 16px 8px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--textSecondary); }`, `
h(function Demo() {
  function Set(props) {
    var st = React.useState(props.start), v = st[0], set = st[1];
    return h('div', { className: 'gc' }, ['loved', 'fine', 'disliked'].map(function (k) {
      return h(B.BucketButton, { key: k, bucket: k, material: props.material, selected: v === k, onClick: function () { set(k); } });
    }));
  }
  return h(B.BevGlow, { color: '#f4a7b9' },
    h('p', { className: 'mat' }, 'Liquid glass · iOS 26+'),
    h(Set, { material: 'glass', start: 'loved' }),
    h('p', { className: 'mat' }, 'Tint fallback · Android, iOS before 26'),
    h(Set, { material: 'tint', start: 'fine' }));
})`];

P.BevGlow = [{ group: 'Ranking', height: 300, width: 393 }, `.hero { display: flex; flex-direction: column; align-items: center; padding: 24px 16px 32px; text-align: center; } .art { width: 168px; height: 168px; }`, `
h(B.BevGlow, { color: '#c9a27e' },
  h('div', { className: 'hero' },
    h('div', { className: 'art' }, h(B.BevArt, BEVS.brownSugar.art)),
    h('p', { className: 'screenTitle', style: { margin: '8px 0 0' } }, 'Brown Sugar Boba'),
    h('p', { className: 'body bv-meta', style: { margin: 0 } }, 'Tiger Sugar')))`];

P.CompareCard = [{ group: 'Ranking', height: 310, width: 393 }, '', `
h('div', { className: 'pv-col' },
  h(B.CompareCard, { bev: BEVS.horchata, isNew: true }),
  h(B.CompareCard, { bev: BEVS.mexicanCoke, rankLabel: '#3 in Loved', selected: true }))`];

P.ProgressDots = [{ group: 'Ranking', height: 80 }, '', `
h('div', { className: 'pv', style: { gap: 40 } }, L('step 1 of 5', h(B.ProgressDots, { total: 5, current: 0 })), L('step 3 of 5', h(B.ProgressDots, { total: 5, current: 2 })), L('last', h(B.ProgressDots, { total: 4, current: 3 })))`];

// ---------- Feedback ----------
P.EmptyState = [{ group: 'Feedback', height: 260, width: 393 }, '', `
h(B.EmptyState, { icon: 'users', title: 'Follow friends to see their Bevs', body: "Rankings from people you follow show up here. Featured Bevs stay above.", action: 'Find people' })`];

P.ErrorState = [{ group: 'Feedback', height: 260, width: 393 }, '', `
h(B.ErrorState, { icon: 'wifi-off', title: "You're offline", message: "We'll show your list again as soon as you're back online." })`];

P.Skeleton = [{ group: 'Feedback', height: 420, width: 393 }, '', `
h('div', { className: 'pv-narrow' }, h(B.Skeleton, { variant: 'row' }), h(B.Skeleton, { variant: 'post' }))`];

P.Sheet = [{ group: 'Feedback', height: 460, width: 393 }, `.pv-frame { height: 440px; margin: 10px auto; } .opt { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; min-height: 48px; border-bottom: 1px solid var(--border); font-size: 17px; }`, `
h('div', { className: 'pv-frame' },
  h('div', { style: { padding: 16 } }, h(B.ListScopeDropdown, { label: 'All' })),
  h(B.Sheet, { title: 'Show', snap: 75 },
    h('div', { className: 'opt' }, 'All Bevs', h(B.Icon, { name: 'check', size: 20, strokeWidth: 2.5, style: { color: 'var(--primary)' } })),
    B.categories.slice(0, 6).map(function (c) { return h('div', { key: c.id, className: 'opt' }, h('span', { style: { display: 'flex', gap: 12, alignItems: 'center' } }, h(B.Icon, { name: c.icon, size: 20 }), c.label)); })))`];

// ---------- Screens (showcase pages) ----------
const PHONE_CSS = `
  p, h1, h2 { margin: 0; }
  .phone { position: relative; width: 393px; height: 852px; overflow: hidden; display: flex; flex-direction: column; background: var(--surface); }
  .status { flex: none; height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 6px 34px 0 44px; font-size: 17px; font-weight: 600; }
  .status-r { display: flex; gap: 6px; align-items: center; }
  .batt { width: 25px; height: 12px; border: 1.5px solid var(--text); border-radius: 4px; padding: 1.5px; opacity: .9; }
  .batt i { display: block; width: 60%; height: 100%; background: var(--text); border-radius: 1.5px; }
  .scroll { flex: 1; overflow: hidden; }
  .tabbar { flex: none; }
  .carousel { display: flex; gap: 16px; padding: 4px 16px 8px; overflow: hidden; }
  .gutter { padding: 0 16px; }
  .center { display: flex; flex-direction: column; align-items: center; text-align: center; }
`;
const phone = (tab, inner) => `
h('div', { className: 'phone' },
  h('div', { className: 'status' }, '9:41', h('span', { className: 'status-r' }, h('span', { className: 'batt' }, h('i')))),
  h('div', { className: 'scroll' }, ${inner}),
  ${tab ? `h('div', { className: 'tabbar' }, h(B.TabBar, { active: '${tab}', user: ME }))` : 'null'})`;

P.ScreenFeed = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS, phone('feed', `
  h(F, null,
    h(B.Header, { wordmark: true, actions: [{ icon: 'user-plus', label: 'Find people' }] }),
    h('div', { className: 'gutter', style: { padding: '4px 16px 8px' } }, h(B.SearchBar, { placeholder: 'Search a Bev or a person', id: 'feed-q' })),
    h(B.SectionHeader, { title: 'Featured Bevs', action: 'See all' }),
    h('div', { className: 'carousel' },
      h(B.FeaturedCard, { title: 'Brown Sugar Boba', subtitle: 'Boba • $$', art: BEVS.brownSugar.art, tint: '#e9d3bd' }),
      h(B.FeaturedCard, { title: 'Top 10 Sparkling Waters', subtitle: "You've had 3 of 10", art: BEVS.topo.art, tint: '#cfe8e0' }),
      h(B.FeaturedCard, { title: 'Red Bull', subtitle: 'Energy • $$', art: BEVS.redBull.art, tint: '#d8def0' })),
    h(B.SectionHeader, { title: 'Your feed' }),
    h(B.FeedPost, { actor: ARJUN, bev: BEVS.horchata, score: 9.5, time: '5 hours ago', note: 'cinnamon-forward, not too sweet. best thing on the block' }))`)];

P.ScreenYourLists = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `.top { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; } .filters { display: flex; gap: 10px; padding: 12px 16px 4px; overflow: hidden; }`, phone('lists', `
  h(F, null,
    h(B.Header, { centered: true, title: 'Your lists', actions: [{ icon: 'share', label: 'Share' }] }),
    h('div', { className: 'top' }, h(B.ListScopeDropdown, { label: 'All' })),
    h(B.SegmentedTabs, { tabs: [{ id: 'bevd', label: "Bev'd" }, { id: 'want', label: 'Want to Try' }, { id: 'recs', label: 'Recommended' }], value: 'bevd' }),
    h('div', { className: 'filters' }, h(B.FilterPill, { count: 0 }), h(B.FilterPill, { label: 'Bucket', icon: null, chevron: true }), h(B.FilterPill, { label: 'Price', icon: null, chevron: true }), h(B.FilterPill, { label: 'Category', icon: null, chevron: true })),
    h(B.SortToggle, { label: 'Score', onClick: function () {}, onSearch: function () {} }),
    h(B.BevRow, { bev: BEVS.horchata, number: 1, score: 9.5, meta: 'Ranked Oct 8' }),
    h(B.BevRow, { bev: BEVS.dietCoke, number: 2, score: 9.3, meta: 'Ranked Oct 3' }),
    h(B.BevRow, { bev: BEVS.mexicanCoke, number: 3, score: 8.9, meta: 'Ranked Sep 30' }),
    h(B.BevRow, { bev: BEVS.redBull, number: 4, score: 6.1, meta: 'Ranked Sep 22' }))`)];

P.ScreenRanking = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .rk-top { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 16px; height: 44px; }
  .rk-prompt { margin: 20px 16px 16px; }
  .rk-cards { display: flex; flex-direction: column; gap: 12px; padding: 0 16px; }
  .rk-or { align-self: center; font-size: 13px; color: var(--textSecondary); font-weight: 600; letter-spacing: .5px; }
  .rk-foot { display: flex; align-items: center; justify-content: space-between; padding: 20px 16px; }`, phone(null, `
  h(F, null,
    h('div', { className: 'rk-top' }, h(B.ProgressDots, { total: 5, current: 1 }), h(B.IconButton, { icon: 'x', label: 'Discard ranking', variant: 'filled' })),
    h('p', { className: 'displayDrop rk-prompt' }, 'Which was better?'),
    h('div', { className: 'rk-cards' },
      h(B.CompareCard, { bev: BEVS.horchata, isNew: true }),
      h('span', { className: 'rk-or' }, 'OR'),
      h(B.CompareCard, { bev: BEVS.mexicanCoke, rankLabel: '#3 in Loved' })),
    h('div', { className: 'rk-foot' }, h(B.Pill, { variant: 'outlined' }, 'Too close to call'), h(B.Button, { variant: 'ghost', size: 'md', icon: 'undo-2' }, 'Undo')))`)];

P.ScreenGutCheck = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .phone > .bv-glow { position: absolute; inset: 0; }
  .gc-top { display: flex; justify-content: flex-end; align-items: center; height: 44px; padding: 0 8px; }
  .gc-hero { display: flex; flex-direction: column; align-items: center; padding: 8px 16px 0; text-align: center; }
  .gc-art { width: 200px; height: 200px; }
  .gc-cat { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; }
  .gc-q { margin: 36px 16px 16px; }
  .gc-btns { display: flex; flex-direction: column; gap: 14px; padding: 0 16px; }
  .gc-hint { margin: 20px 16px 0; text-align: center; }`, `
h('div', { className: 'phone' },
  h(B.BevGlow, { color: '#f4a7b9' },
    h('div', { className: 'status' }, '9:41', h('span', { className: 'status-r' }, h('span', { className: 'batt' }, h('i')))),
    h('div', { className: 'gc-top' }, h(B.IconButton, { icon: 'x', label: 'Discard ranking', variant: 'filled' })),
    h('div', { className: 'gc-hero' },
      h('div', { className: 'gc-art' }, h(B.BevArt, BEVS.pamplemousse.art)),
      h('h1', { className: 'screenTitle', style: { marginTop: 12 } }, 'LaCroix Pamplemousse'),
      h('p', { className: 'body bv-meta' }, 'LaCroix'),
      h('p', { className: 'body gc-cat' }, h(B.Icon, { name: 'droplets', size: 16, strokeWidth: 2 }), ' Sparkling water • ', h(B.PriceTier, { tier: 1 }))),
    h('p', { className: 'displayDrop gc-q' }, 'How was it?'),
    h('div', { className: 'gc-btns' }, h(B.BucketButton, { bucket: 'loved', selected: true }), h(B.BucketButton, { bucket: 'fine' }), h(B.BucketButton, { bucket: 'disliked' })),
    h('p', { className: 'caption bv-meta gc-hint' }, "Next, you'll compare it with Bevs you've already ranked.")))`];

P.ScreenBevDetail = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .bd-hero { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 16px 16px; text-align: center; }
  .bd-cat { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; }
  .bd-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 10px; }
  .bd-stat { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-stat); text-align: center; }
  .bd-friends { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px; }
  .bd-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 16px; }
  .bd-btns > * { width: 100%; justify-content: center; height: 44px; }`, phone('lists', `
  h(F, null,
    h(B.Header, { onBack: function () {}, actions: [{ icon: 'ellipsis', label: 'More' }] }),
    h('div', { className: 'bd-hero' },
      h(B.BevImage, { size: 155, art: BEVS.horchata.art, alt: 'Horchata' }),
      h('h1', { className: 'screenTitle', style: { marginTop: 12 } }, 'Horchata'),
      h('p', { className: 'body bv-meta' }, 'Tacos El Gordo'),
      h('p', { className: 'body bd-cat' }, h(B.Icon, { name: 'globe', size: 16, strokeWidth: 2 }), ' Other • ', h(B.PriceTier, { tier: 2, estimated: true }))),
    h('div', { className: 'bd-stats' },
      h('div', { className: 'bd-stat' }, h(B.ScoreBubble, { score: 8.7, size: 56 }), h('div', null, h('p', { className: 'heading' }, 'Bevi score'), h('p', { className: 'body bv-meta' }, '5k ratings'))),
      h('div', { className: 'bd-stat' }, h(B.ScoreBubble, { score: 9.1, size: 56, variant: 'predicted' }), h('div', null, h('p', { className: 'heading' }, "You'd rate it"), h('p', { className: 'body bv-meta' }, 'from your tastes')))),
    h('div', { className: 'bd-friends' },
      h('div', null, h('p', { className: 'heading' }, "Friends who've had it"), h('p', { className: 'body bv-meta' }, 'Arjun 9.5 · Jack 8.1 · 2 more')),
      h(B.AvatarStack, { people: [ARJUN, FRIENDS[0], FRIENDS[1], FRIENDS[2]], max: 3 })),
    h('div', { className: 'bd-btns' }, h(B.Pill, { variant: 'filled', icon: 'circle-plus' }, 'Rank it'), h(B.Pill, { variant: 'outlined', icon: 'bookmark' }, 'Want to Try')),
    h('p', { className: 'caption bv-meta', style: { padding: '24px 16px', textAlign: 'center' } }, 'Added by @acheema5'))`)];

P.ScreenProfile = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .pf-id { display: flex; flex-direction: column; align-items: center; padding-top: 1px; }
  .pf-counts { display: grid; grid-template-columns: repeat(3, 1fr); padding: 16px 0 0; text-align: center; }
  .pf-counts p { margin: 0; }
  .pf-btns { display: flex; justify-content: center; gap: 4px; padding: 20px 0 14px; }
  .pf-btns > :nth-child(-n+2) { width: 120px; } .pf-btns > :last-child { width: 34px; padding: 0; }
  .pf-rows { border-top: 1px solid var(--border); }
  .pf-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 20px 10px 14px; }`, phone('profile', `
  h(F, null,
    h(B.Header, { title: 'Matt Willer', actions: [{ icon: 'share', label: 'Share profile' }, { icon: 'menu', label: 'Settings' }] }),
    h('div', { className: 'pf-id' },
      h(B.Avatar, { name: ME.name, size: 100 }),
      h('p', { className: 'heading', style: { marginTop: 16, fontWeight: 700 } }, '@mbwiller'),
      h('p', { className: 'body bv-meta' }, 'Member since Oct 2026')),
    h('div', { className: 'pf-counts' },
      h('div', null, h('p', { className: 'heading' }, '7'), h('p', { className: 'body bv-meta' }, 'Followers')),
      h('div', null, h('p', { className: 'heading' }, '9'), h('p', { className: 'body bv-meta' }, 'Following')),
      h('div', null, h('p', { className: 'heading' }, '#12'), h('p', { className: 'body bv-meta' }, 'Rank on Bevi'))),
    h('div', { className: 'pf-btns' }, h(B.Button, null, 'Edit profile'), h(B.Button, null, 'Share profile'), h(B.Button, { icon: 'chevron-down', 'aria-label': 'Settings' })),
    h('div', { className: 'pf-rows' },
      h(B.ProfileListRow, { icon: 'circle-check', label: "Bev'd", count: 42 }),
      h(B.ProfileListRow, { icon: 'bookmark', iconFilled: true, label: 'Want to Try', count: 7 }),
      h(B.ProfileListRow, { icon: 'heart', label: 'Recommended for you' })),
    h('div', { className: 'pf-stats' }, h(B.StatCard, { icon: 'trophy', label: 'Rank on Bevi', value: '#12' }), h(B.StatCard, { icon: 'flame', label: 'Current Streak', value: '4 days' })),
    h(B.SegmentedTabs, { variant: 'underline-icon', tabs: [{ id: 'activity', label: 'Activity', icon: 'file-text' }, { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' }], value: 'activity' }),
    h(B.FeedPost, { you: true, actor: ME, bev: BEVS.dietCoke, score: 9.3, time: 'Wednesday', note: 'the fountain one at the dining hall hits different' }))`)];

P.ScreenLeaderboard = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `.top { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }`, phone('leaderboard', `
  h(F, null,
    h(B.Header, { centered: true, title: 'Leaderboard' }),
    h(B.SegmentedTabs, { tabs: [{ id: 'bevs', label: 'Bevs' }, { id: 'people', label: 'People' }], value: 'bevs' }),
    h('div', { className: 'top' }, h(B.ListScopeDropdown, { label: 'All' })),
    h(B.BevRow, { bev: BEVS.horchata, number: 1, score: 8.9, meta: 'Your score 9.5', actions: true }),
    h(B.BevRow, { bev: BEVS.mexicanCoke, number: 2, score: 8.7, meta: 'Your score 8.9' }),
    h(B.BevRow, { bev: BEVS.brownSugar, number: 3, score: 8.5, meta: 'Not ranked yet', saved: true }),
    h(B.BevRow, { bev: BEVS.topo, number: 4, score: 8.4, meta: 'Your score 7.9' }))`)];

P.ScreenAddBev = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .ab-q { padding: 16px 16px 12px; } .ab-pills { display: flex; gap: 10px; padding: 0 16px 8px; }
  .recent { display: flex; align-items: center; gap: 14px; padding: 0 8px 0 16px; min-height: 62px; border-bottom: 1px solid var(--border); }
  .recent-t { flex: 1; display: flex; flex-direction: column; }
  .ab-foot { position: absolute; left: 0; right: 0; bottom: 83px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--surface); }`, phone('add', `
  h(F, null,
    h(B.Header, { wordmark: true, actions: [{ icon: 'x', label: 'Close', variant: 'filled' }] }),
    h(B.SegmentedTabs, { variant: 'underline-icon', accent: 'primary', tabs: [{ id: 'bevs', label: 'Bevs', icon: 'cup-soda' }, { id: 'people', label: 'People', icon: 'users' }], value: 'bevs' }),
    h('div', { className: 'ab-q' }, h(B.SearchBar, { variant: 'outlined', placeholder: 'Search a Bev, brand or flavor', id: 'add-q' })),
    h('div', { className: 'ab-pills' }, h(B.Pill, { variant: 'filled', icon: 'camera' }, 'Snap it')),
    h('p', { className: 'heading', style: { padding: '12px 16px 4px', fontWeight: 700 } }, 'Recents'),
    [BEVS.horchata, BEVS.dietCoke, BEVS.brownSugar, BEVS.coldBrew].map(function (b) {
      return h('div', { key: b.name, className: 'recent' }, h(B.Icon, { name: 'clock', size: 22, style: { color: 'var(--textSecondary)' } }),
        h('span', { className: 'recent-t' }, h('span', { className: 'bodyLarge' }, b.name), h('span', { className: 'body bv-meta' }, b.brand)),
        h(B.IconButton, { icon: 'x', label: 'Forget ' + b.name, size: 20 }));
    }),
    h('div', { className: 'ab-foot' }, h(B.Button, { variant: 'outlined', block: true, icon: 'circle-plus' }, "Can't find it? Add a new Bev")))`)];

for (const [name, [opts, css, code]] of Object.entries(P)) {
  const dir = path.join(ROOT, 'project/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preview.html'), page(name, opts, css, code));
}
console.log('wrote', Object.keys(P).length, 'previews');

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
    dietCoke: { name: 'Diet Coke', brand: 'Coca-Cola', category: 'diet_soda', priceTier: 1, art: { kind: 'can', color: '#d6d6db', accent: '#c8102e' }, bayesScore: 8.8, ratingCount: 204 },
    mexicanCoke: { name: 'Mexican Coke', brand: 'Coca-Cola', category: 'soda', priceTier: 2, art: { kind: 'bottle', color: '#3b1d12', accent: '#e03a3e' }, bayesScore: 8.7, ratingCount: 362 },
    topo: { name: 'Topo Chico', brand: 'Topo Chico', category: 'sparkling_water', priceTier: 1, art: { kind: 'bottle', color: '#a9d8c9', accent: '#f2c94c' }, bayesScore: 8.4, ratingCount: 97 },
    pamplemousse: { name: 'LaCroix Pamplemousse', brand: 'LaCroix', flavor: 'Pamplemousse', category: 'sparkling_water', priceTier: 1, art: { kind: 'can', color: '#f4a7b9', accent: '#ffffff' } },
    redBull: { name: 'Red Bull', brand: 'Red Bull', category: 'energy', priceTier: 2, art: { kind: 'slimCan', color: '#2d4fa1', accent: '#c0c4cc' } },
    brownSugar: { name: 'Brown Sugar Boba', brand: 'Tiger Sugar', category: 'boba', priceTier: 2, art: { kind: 'boba', color: '#c9a27e', accent: '#7a4a2a' }, bayesScore: 8.5, ratingCount: 5120 },
    horchata: { name: 'Horchata', brand: 'Tacos El Gordo', category: 'other', priceTier: 2, priceEstimated: true, art: { kind: 'icedCup', color: '#efe4d0', accent: '#b07a45' }, bayesScore: 8.9, ratingCount: 362 },
    coldBrew: { name: 'Cold Brew', brand: 'Blue Bottle', category: 'coffee', priceTier: 2, art: { kind: 'icedCup', color: '#4a2c1d', accent: '#3c7dd9' }, bayesScore: 8.1, ratingCount: 41 },
    sprite: { name: 'Sprite', brand: 'Coca-Cola', category: 'soda', priceTier: 1, art: { kind: 'can', color: '#1f8f4e', accent: '#f2d230' } },
    gatorade: { name: 'Gatorade Cool Blue', brand: 'Gatorade', category: 'sports', priceTier: 1, art: { kind: 'waterBottle', color: '#3aa0e0', accent: '#f26b1d' } },
    oj: { name: 'Orange Juice', brand: 'Tropicana', category: 'juice', priceTier: 1, art: { kind: 'carton', color: '#f6a623', accent: '#2f9e44' } },
    poppi: { name: 'Strawberry Lemon', brand: 'Poppi', category: 'diet_soda', priceTier: 2, art: { kind: 'can', color: '#f7c6cf', accent: '#e8384f' } },
    matcha: { name: 'Iced Matcha Latte', brand: 'Starbucks', category: 'tea', priceTier: 2, art: { kind: 'icedCup', color: '#9cbf6b', accent: '#1e7a46' }, bayesScore: 8.4, ratingCount: 41 },
  };
  var ME = { name: 'Matt Willer', handle: 'mbwiller' };
  // A stand-in profile photo for previews (an SVG gradient; real ones are the person's upload).
  var PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2B263"/><stop offset="1" stop-color="#8E44AD"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="40" r="18" fill="#FFF4E0"/><ellipse cx="50" cy="86" rx="30" ry="22" fill="#FFF4E0"/></svg>');
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

P.ScoreBubble = [{ group: 'Bev', height: 230 }, '', `
h('div', { className: 'pv', style: { gap: 28 } },
  L('Loved band', h(B.ScoreBubble, { score: 9.3 })),
  L('Fine band', h(B.ScoreBubble, { score: 5.8 })),
  L("Didn't like", h(B.ScoreBubble, { score: 2.1 })),
  L('predicted', h(B.ScoreBubble, { score: 8.2, variant: 'predicted' })),
  L('locked', h(B.ScoreBubble, { variant: 'locked' })),
  L('56 · detail', h(B.ScoreBubble, { score: 8.9, size: 56 })),
  L('56 predicted', h(B.ScoreBubble, { score: 7.6, size: 56, variant: 'predicted' })),
  L('72 · note step', h(B.ScoreBubble, { score: 8.9, size: 72 })),
  L('72 · first in Fine', h(B.ScoreBubble, { score: 5.5, size: 72 })))`];

P.PriceTier = [{ group: 'Bev', height: 96 }, `.line { font-size: 15px; line-height: 20px; }`, `
h('div', { className: 'pv', style: { gap: 32 } },
  [1, 2, 3, 4].map(function (t) { return h(F, { key: t }, L('tier ' + t, h('span', { className: 'line' }, h(B.PriceTier, { tier: t }), ' • Soda'))); }),
  L('estimated', h('span', { className: 'line' }, h(B.PriceTier, { tier: 2, estimated: true }), ' • Other')))`];

P.BevRow = [{ group: 'Bev', height: 500, width: 393, subtitle: 'About 94pt' }, '', `
h('div', { className: 'pv-narrow' },
  h(B.BevRow, { bev: BEVS.dietCoke, number: 1, score: 9.3, meta: 'Ranked Oct 3' }),
  h(B.BevRow, { bev: BEVS.horchata, number: 2, score: 8.8, meta: 'Ranked Sep 28', saved: false }),
  h(B.BevRow, { bev: BEVS.brownSugar, score: 7.3, count: 5120, saved: true, meta: 'Saved from @acheema5' }),
  h(B.BevRow, { bev: BEVS.poppi, score: 8.2, scoreVariant: 'predicted', meta: 'You love diet sodas' }),
  h(B.BevRow, { bev: BEVS.mexicanCoke, score: 8.7, count: 362, showImage: true }))`];

P.ProgressStrip = [{ group: 'Bev', height: 300, width: 393, subtitle: 'Opens your collection' }, `.stack { display: flex; flex-direction: column; gap: 14px; padding: 16px 0; } .cap { margin: 0 16px -8px; font-size: 12px; line-height: 16px; color: var(--textSecondary); }`, `
h('div', { className: 'stack' },
  h('p', { className: 'cap' }, 'All categories'),
  h(B.ProgressStrip, { label: 'All Bevs', ranked: 37, total: 378, onClick: function () {} }),
  h('p', { className: 'cap' }, 'One category'),
  h(B.ProgressStrip, { label: 'Soda', ranked: 4, total: 61, onClick: function () {} }),
  h('p', { className: 'cap' }, 'Tried one of many: never 0%'),
  h(B.ProgressStrip, { label: 'Coffee', ranked: 1, total: 140, onClick: function () {} }),
  h('p', { className: 'cap' }, 'Nothing yet'),
  h(B.ProgressStrip, { label: 'Boba', ranked: 0, total: 22, onClick: function () {} }))`];

P.ProgressBar = [{ group: 'Bev', height: 110, width: 393 }, `.bars { display: flex; flex-direction: column; gap: 14px; padding: 20px 16px; } .bars .pv-stack { align-items: stretch; }`, `
h('div', { className: 'bars' }, L('0', h(B.ProgressBar, { value: 0 })), L('9%', h(B.ProgressBar, { value: 0.09 })), L('66%', h(B.ProgressBar, { value: 2 / 3 })))`];

P.CollectionSheet = [{ group: 'Bev', height: 760, width: 393, subtitle: 'Tap a category to show only it' }, `.pv-frame { height: 740px; margin: 10px auto; }`, `
h('div', { className: 'pv-frame' },
  h(B.ProgressStrip, { label: 'All Bevs', ranked: 37, total: 378 }),
  h(B.CollectionSheet, { rows: [
    { categoryId: 'soda', ranked: 4, total: 61 }, { categoryId: 'diet_soda', ranked: 6, total: 34 }, { categoryId: 'juice', ranked: 0, total: 25 },
    { categoryId: 'sparkling_water', ranked: 7, total: 30 }, { categoryId: 'energy', ranked: 2, total: 28 }, { categoryId: 'coffee', ranked: 9, total: 40 },
    { categoryId: 'tea', ranked: 3, total: 26 }, { categoryId: 'boba', ranked: 5, total: 22 }, { categoryId: 'smoothie', ranked: 0, total: 0 }, { categoryId: 'other', ranked: 1, total: 112 },
  ] }))`];

P.FeaturedCard = [{ group: 'Bev', height: 210 }, `.row { display: flex; gap: 16px; padding: 20px 16px; overflow-x: auto; }`, `
h('div', { className: 'row' },
  h(B.FeaturedCard, { title: 'Brown Sugar Boba', subtitle: 'Boba • $$', art: BEVS.brownSugar.art, tint: '#e9d3bd' }),
  h(B.FeaturedCard, { title: 'Top 10 Sparkling Waters', subtitle: "You've had 3 of 10", art: BEVS.topo.art, tint: '#cfe8e0' }),
  h(B.FeaturedCard, { title: 'Red Bull', subtitle: 'Energy • $$', art: BEVS.redBull.art, tint: '#d8def0' }))`];

P.BevOfCard = [{ group: 'Bev', height: 600, width: 393 }, `.cap { margin: 0 16px; padding-top: 14px; font-size: 12px; line-height: 16px; color: var(--textSecondary); }`, `
h('div', { className: 'pv-narrow' },
  h('p', { className: 'cap' }, 'Two winners'),
  h('div', { className: 'bv-bevof-pair' },
    h(B.BevOfCard, { period: 'day', bev: BEVS.horchata, score: 8.9 }),
    h(B.BevOfCard, { period: 'week', bev: BEVS.topo, score: 8.4, date: 'Week of Oct 12' })),
  h('p', { className: 'cap' }, 'The same Bev won the day and the week: one card'),
  h('div', { className: 'bv-bevof-pair' },
    h(B.BevOfCard, { period: 'both', bev: BEVS.horchata, score: 8.9 })))`];

// ---------- People ----------
P.Avatar = [{ group: 'People', height: 150 }, '', `
h('div', { className: 'pv', style: { alignItems: 'flex-end' } },
  L('24 · comments', h(B.Avatar, { name: FRIENDS[1].name, size: 24 })),
  L('32 · tab bar', h(B.Avatar, { name: ME.name, size: 32 })),
  L('44 · rows and posts', h(B.Avatar, { name: ARJUN.name, size: 44 })),
  L('60', h(B.Avatar, { name: 'Priya Nair', size: 60 })),
  L('100 · profile', h(B.Avatar, { name: ME.name, size: 100 })))`];

P.AvatarPicker = [{ group: 'People', height: 230, subtitle: 'Edit profile and onboarding' }, '', `
h('div', { className: 'pv', style: { alignItems: 'flex-start', gap: 40 } },
  L('no photo', h(B.AvatarPicker, { name: ME.name })),
  L('with a photo', h(B.AvatarPicker, { name: ME.name, src: PHOTO, onRemove: function () {} })),
  L('uploading', h(B.AvatarPicker, { name: ME.name, src: PHOTO, busy: true, onRemove: function () {} })),
  L('failed', h(B.AvatarPicker, { name: ME.name, error: "Couldn't upload your photo. Try another one." })))`];

P.AvatarStack = [{ group: 'People', height: 96 }, '', `
h('div', { className: 'pv', style: { gap: 40 } },
  L('Friends who have had it', h(B.AvatarStack, { people: FRIENDS })),
  L('two friends', h(B.AvatarStack, { people: FRIENDS.slice(0, 2) })),
  L("24 · Bev'd it too, on a post", h(B.AvatarStack, { people: FRIENDS.slice(0, 2), size: 24, max: 2 })))`];

P.UserRow = [{ group: 'People', height: 410, width: 393, subtitle: 'Tap Follow' }, '', `
h('div', { className: 'pv-narrow' },
  h(B.UserRow, { user: ARJUN, meta: '84 Bevs', following: true }),
  h(function Row() { var st = React.useState(false); return h(B.UserRow, { user: FRIENDS[1], meta: '31 Bevs', following: st[0], onFollow: function () { st[1](!st[0]); } }); }),
  h(B.UserRow, { user: FRIENDS[3], meta: '52 Bevs', context: 'Followed by Sam and Arjun', following: false }),
  h(B.UserRow, { user: FRIENDS[0], rank: 1, meta: '212 pts', streak: 14 }),
  h(B.UserRow, { user: ME, rank: 12, meta: '96 pts', streak: 4, self: true, divider: false }))`];

P.StatCard = [{ group: 'People', height: 130, width: 393 }, `.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px 10px; }`, `
h('div', { className: 'two' },
  h(B.StatCard, { icon: 'trophy', label: 'Rank on Bevi', value: '#12' }),
  h(B.StatCard, { icon: 'flame', label: 'Current streak', value: '4 days' }))`];

P.ProfileListRow = [{ group: 'People', height: 126, width: 393 }, `.list { padding-top: 12px; border-top: 1px solid var(--border); }`, `
h('div', { className: 'pv-narrow' },
  h(B.ProfileListRow, { icon: 'bookmark', iconFilled: true, label: 'Want to Try', count: 7 }),
  h(B.ProfileListRow, { icon: 'heart', label: 'Recommended for you' }))`];

P.TasteBar = [{ group: 'People', height: 250, width: 393, subtitle: 'Score band colours' }, `.tb { padding: 12px 16px; }`, `
h('div', { className: 'tb' },
  h(B.TasteBar, { categoryId: 'coffee', mean: 8.1, rankingCount: 9 }),
  h(B.TasteBar, { categoryId: 'boba', mean: 7.9, rankingCount: 4 }),
  h(B.TasteBar, { categoryId: 'tea', mean: 6.3, rankingCount: 3 }),
  h(B.TasteBar, { categoryId: 'soda', mean: 3.8, rankingCount: 5 }))`];

P.TasteProfile = [{ group: 'People', height: 520, width: 393, subtitle: 'Read-out over the bars' }, `.cap { margin: 0 16px; padding-top: 16px; font-size: 12px; line-height: 16px; color: var(--textSecondary); }`, `
h('div', { className: 'pv-narrow' },
  h(B.TasteProfile, { readout: 'You prefer coffee and boba over soda', rows: [
    { categoryId: 'coffee', mean: 8.1, rankingCount: 9 },
    { categoryId: 'boba', mean: 7.9, rankingCount: 4 },
    { categoryId: 'tea', mean: 6.3, rankingCount: 3 },
    { categoryId: 'soda', mean: 3.8, rankingCount: 5 }] }),
  h('p', { className: 'cap' }, 'No pair with 3+ rankings and a gap of 1: no read-out'),
  h(B.TasteProfile, { rows: [
    { categoryId: 'juice', mean: 7.2, rankingCount: 2 },
    { categoryId: 'water', mean: 6.8, rankingCount: 1 }] }))`];

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

P.Button = [{ group: 'Actions', height: 200, width: 393 }, `.prof { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }`, `
h('div', { className: 'pv-col' },
  h('div', { className: 'prof' },
    h(B.Button, null, 'Edit profile'), h(B.Button, null, 'Share profile')),
  h(B.Button, { variant: 'primary', block: true }, 'Rank it'),
  h('div', { style: { display: 'flex', gap: 12 } }, h(B.Button, { variant: 'primary', loading: true }, 'Rank it'), h(B.Button, { variant: 'ghost', size: 'md' }, 'Skip')))`];

P.IconButton = [{ group: 'Actions', height: 110 }, '', `
h('div', { className: 'pv', style: { gap: 12 } },
  L('plain', h(B.IconButton, { icon: 'user-plus', label: 'Find people' })),
  L('settings', h(B.IconButton, { icon: 'settings', label: 'Settings' })),
  L('share', h(B.IconButton, { icon: 'share', label: 'Share' })),
  L('filled close', h(B.IconButton, { icon: 'x', label: 'Close', variant: 'filled' })),
  L('with badge', h(B.IconButton, { icon: 'menu', label: 'Menu', badge: 4 })))`];

P.LikeButton = [{ group: 'Actions', height: 110, subtitle: 'Tap to like' }, '', `
h(function Demo() {
  var st = React.useState(true), on = st[0], set = st[1];
  return h('div', { className: 'pv', style: { gap: 16 } },
    L('not liked', h(B.LikeButton, { count: 12 })),
    L('liked', h(B.LikeButton, { liked: on, count: on ? 13 : 12, onClick: function () { set(!on); } })),
    L('no likes yet', h(B.LikeButton, {})),
    L('liked, 1', h(B.LikeButton, { liked: true, count: 1 })),
    L('5k', h(B.LikeButton, { liked: true, count: 5120 })));
})`];

P.CommentButton = [{ group: 'Actions', height: 110, subtitle: 'Opens the comments' }, '', `
h('div', { className: 'pv', style: { gap: 16 } },
  L('no comments yet', h(B.CommentButton, {})),
  L('1', h(B.CommentButton, { count: 1 })),
  L('12', h(B.CommentButton, { count: 12 })),
  L('5k', h(B.CommentButton, { count: 5120 })),
  L('beside the heart', h('span', { style: { display: 'inline-flex' } }, h(B.LikeButton, { liked: true, count: 4 }), h(B.CommentButton, { count: 3 }))))`];

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
P.Header = [{ group: 'Navigation', height: 300, width: 393 }, `.hd { border-bottom: 1px solid var(--border); }`, `
h('div', { className: 'pv-narrow' },
  h('div', { className: 'hd' }, h(B.Header, { wordmark: true, actions: [{ icon: 'user-plus', label: 'Find people' }] })),
  h('div', { className: 'hd' }, h(B.Header, { title: 'Matt Willer', actions: [{ icon: 'menu', label: 'Settings' }] })),
  h('div', { className: 'hd' }, h(B.Header, { centered: true, title: 'Lists' })),
  h('div', { className: 'hd' }, h(B.Header, { title: 'Add a Bev' })),
  h('div', { className: 'hd' }, h(B.Header, { title: 'People', onBack: function () {} })),
  h(B.Header, { title: 'Diet Coke', onBack: function () {}, actions: [{ icon: 'ellipsis', label: 'More' }] }))`];

P.SectionHeader = [{ group: 'Navigation', height: 110, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { paddingTop: 12 } }, h(B.SectionHeader, { title: 'Featured Bevs', action: 'See all' }), h(B.SectionHeader, { title: 'Your feed' }))`];

P.ListScopeDropdown = [{ group: 'Navigation', height: 80 }, '', `
h('div', { className: 'pv', style: { gap: 40 } }, h(B.ListScopeDropdown, { label: 'All' }), h(B.ListScopeDropdown, { label: 'Sparkling water' }))`];

P.SegmentedTabs = [{ group: 'Navigation', height: 200, width: 393 }, '', `
h('div', { className: 'pv-narrow', style: { display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 12 } },
  h(function Tabs() { var st = React.useState('recommended'); return h(B.SegmentedTabs, { tabs: [{ id: 'bevd', label: "Bev'd" }, { id: 'want', label: 'Want to Try' }, { id: 'recommended', label: 'For you' }, { id: 'top', label: 'Top' }], value: st[0], onChange: st[1] }); }),
  h(B.SegmentedTabs, { variant: 'underline-icon', tabs: [{ id: 'activity', label: 'Activity', icon: 'file-text' }, { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' }], value: 'activity' }),
  h(B.SegmentedTabs, { variant: 'underline-icon', accent: 'primary', tabs: [{ id: 'bevs', label: 'Bevs', icon: 'cup-soda' }, { id: 'people', label: 'People', icon: 'users' }], value: 'bevs' }))`];

P.TabBar = [{ group: 'Navigation', height: 330, width: 393, subtitle: 'Tap a tab' }, '', `
h('div', { className: 'pv-narrow', style: { display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 28 } },
  h(function Bar() { var st = React.useState('feed'); return h(B.TabBar, { active: st[0], user: ME, safeArea: false, onChange: st[1] }); }),
  h(B.TabBar, { active: 'map', user: ME, safeArea: false }),
  h(B.TabBar, { active: 'profile', user: ME }))`];

// ---------- Feed ----------
P.FeedPost = [{ group: 'Feed', height: 1640, width: 393, subtitle: 'Double-tap a post to like it' }, '.pv-mat { margin: 0; padding: 20px 16px 0; }', `
h(function Demo() {
  var a = React.useState(false), aOn = a[0], setA = a[1];
  var b = React.useState(true), bOn = b[0], setB = b[1];
  var c = React.useState(false), cOn = c[0], setC = c[1];
  // A post shows each action (heart, comment, Rank it, Want to Try) only with its handler.
  var NOOP = function () {};
  var ACTIONS = { onLike: NOOP, onComment: NOOP, onRank: NOOP, onSave: NOOP };
  return h('div', { className: 'pv-narrow' },
    h(B.FeedPost, { actor: ARJUN, bev: BEVS.horchata, score: 9.5, time: '5 hours ago', liked: aOn, likeCount: aOn ? 4 : 3, onLike: function () { setA(!aOn); }, onComment: NOOP, onRank: NOOP, onSave: NOOP,
      alsoBevdBy: [FRIENDS[0], FRIENDS[1]], alsoBevdCount: 5,
      comments: [
        { author: FRIENDS[1], body: 'ok this is going on my list' },
        { author: ME, body: 'the one on 3rd ave or the truck?' },
        { author: ARJUN, body: 'the truck, always the truck' }],
      commentCount: 3,
      note: "went back with my mom and she pulled out a sleeper: the cinnamon is way stronger than the dining hall one and it's not too sweet. honestly the best thing on this whole block, and it costs less than a cold brew. getting two next time" }),
    h(B.FeedPost, { actor: FRIENDS[0], bev: BEVS.brownSugar, score: 7.8, saved: true, time: 'Wednesday', liked: bOn, likeCount: bOn ? 12 : 11, onLike: function () { setB(!bOn); }, onComment: NOOP, onRank: NOOP, onSave: NOOP,
      alsoBevdBy: [ARJUN],
      comments: [{ author: FRIENDS[2], body: 'tiger sugar > everything' }], commentCount: 12 }),
    h(B.FeedPost, Object.assign({ actor: FRIENDS[3], bev: BEVS.topo, score: 6.1, time: 'Monday', likeCount: 1, note: 'fine. it is water' }, ACTIONS)),
    h('p', { className: 'pv-label pv-mat' }, "With the ranker's own photos: the strip scrolls and the note follows"),
    h(B.FeedPost, Object.assign({ actor: FRIENDS[1], bev: BEVS.coldBrew, score: 8.6, time: 'Sunday', note: 'the nitro tap at the 3rd ave one',
      photos: [{ art: BEVS.coldBrew.art }, { art: BEVS.matcha.art }, { art: BEVS.horchata.art }] }, ACTIONS)),
    h('p', { className: 'pv-label pv-mat' }, "Explore: the plain post (no heart, counts or comments) with the author's Follow pill"),
    h(B.FeedPost, { actor: FRIENDS[2], bev: BEVS.matcha, score: 8.2, time: '2 days ago', note: 'oat milk, half sweet. the only one I order now',
      following: cOn, onFollow: function () { setC(!cOn); } }));
})`];

// ---------- Ranking ----------
P.BucketButton = [{ group: 'Ranking', height: 360, width: 393, subtitle: 'Tap one to choose it' }, `.gc { display: flex; gap: 4px; padding: 20px 16px 24px; }
.mat { margin: 0; padding: 20px 16px 0; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--textSecondary); }`, `
h(function Demo() {
  function Set(props) {
    var st = React.useState(props.start), v = st[0], set = st[1];
    return h('div', { className: 'gc' }, ['loved', 'fine', 'disliked'].map(function (k) {
      return h(B.BucketButton, { key: k, bucket: k, selected: v === k, dimmed: v != null && v !== k, onClick: function () { set(v === k ? null : k); } });
    }));
  }
  return h('div', null,
    h('p', { className: 'mat' }, 'Nothing chosen'),
    h(Set, { start: null }),
    h('p', { className: 'mat' }, 'One chosen, the others dimmed'),
    h(Set, { start: 'fine' }));
})`];

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

P.Skeleton = [{ group: 'Feedback', height: 330, width: 393 }, '', `
h('div', { className: 'pv-narrow' }, h(B.Skeleton, { variant: 'row' }), h(B.Skeleton, { variant: 'post' }))`];

P.CommentsSheet = [{ group: 'Feed', height: 1470, width: 393, subtitle: 'Your own comments can be deleted' }, `.pv-frame { height: 440px; margin: 10px auto; } .cap { margin: 14px 16px 0; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--textSecondary); }`, `
h(function Demo() {
  var few = [
    { id: 'a', author: FRIENDS[1], body: 'ok this is going on my list', time: '4 hours ago' },
    { id: 'b', author: ME, body: 'the one on 3rd ave or the truck?', time: '3 hours ago', mine: true },
    { id: 'c', author: ARJUN, body: 'the truck, always the truck', time: '2 hours ago' }];
  var long = [
    { author: FRIENDS[2], body: 'tiger sugar > everything', time: 'Wednesday' },
    { author: FRIENDS[1], body: 'hot take but the brown sugar is too sweet for me', time: 'Wednesday' },
    { author: FRIENDS[0], body: 'that is the point priya', time: 'Wednesday' },
    { author: FRIENDS[5], body: 'less ice and it is perfect', time: 'Thursday' },
    { author: ME, body: 'less ice is the move, agreed', time: 'Thursday', mine: true },
    { author: FRIENDS[3], body: 'which location?', time: 'Thursday' },
    { author: FRIENDS[0], body: 'the one by campus, the line is shorter after 3', time: 'Thursday' },
    { author: ARJUN, body: "ranking it tonight, you've convinced me", time: '5 hours ago' }];
  return h(F, null,
    h('p', { className: 'cap' }, 'Empty'),
    h('div', { className: 'pv-frame' }, h(B.CommentsSheet, { me: ME })),
    h('p', { className: 'cap' }, 'A few, one of them yours'),
    h('div', { className: 'pv-frame' }, h(B.CommentsSheet, { me: ME, comments: few })),
    h('p', { className: 'cap' }, 'A long thread, posting failed'),
    h('div', { className: 'pv-frame', style: { height: 500 } }, h(B.CommentsSheet, { me: ME, comments: long, error: "Couldn't post your comment. Check your connection and try again." })));
})`];

P.Sheet = [{ group: 'Feedback', height: 460, width: 393 }, `.pv-frame { height: 440px; margin: 10px auto; } .opt { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; min-height: 48px; border-bottom: 1px solid var(--border); font-size: 17px; }`, `
h('div', { className: 'pv-frame' },
  h('div', { style: { padding: 16 } }, h(B.ListScopeDropdown, { label: 'All' })),
  h(B.Sheet, { title: 'Show', snap: 75 },
    h('div', { className: 'opt' }, 'All Bevs', h(B.Icon, { name: 'check', size: 20, strokeWidth: 2.5, style: { color: 'var(--primary)' } })),
    B.categories.slice(0, 6).map(function (c) { return h('div', { key: c.id, className: 'opt' }, h('span', { style: { display: 'flex', gap: 12, alignItems: 'center' } }, h(B.Icon, { name: c.icon, size: 20 }), c.label)); })))`];

// ---------- Map ----------
// FindBevArt is the Map tab's art. The venue-map components below it (M-16) are parked: no screen composes them.
// A stand-in for the live Google map in previews only: muted blocks and a river, never drawn in the app.
const MAP_CSS = `
  .mapbg { position: absolute; inset: 0; overflow: hidden; background-color: color-mix(in srgb, var(--input) 65%, var(--surface));
    background-image: repeating-linear-gradient(61deg, transparent 0 46px, var(--border) 46px 49px), repeating-linear-gradient(-29deg, transparent 0 17px, var(--border) 17px 19px); }
  .mapbg-river { position: absolute; top: -20%; bottom: -20%; right: -36px; width: 74px; transform: rotate(29deg); background: color-mix(in srgb, var(--fizz) 22%, var(--surface)); }
  .mapbg-pin { position: absolute; transform: translate(-50%, -100%); }
  .mapbg-credit { position: absolute; left: 4px; bottom: 30px; padding: 0 4px; font-size: 10px; line-height: 13px; color: var(--text); background: var(--glassFill); }
  .mapbg-logo { position: absolute; left: 6px; bottom: 6px; width: 64px; height: 20px; border-radius: 4px; background: color-mix(in srgb, var(--textSecondary) 30%, transparent); }
  .mapbg-terms { position: absolute; right: 0; bottom: 0; width: 170px; height: 14px; background: color-mix(in srgb, var(--surface) 70%, transparent); }`;
// Pins as [x%, y%, score, predicted, kind, selected].
const MAP_PINS = `[[22, 30, 9.1, false, 'craft'], [58, 22, 8.4, false, 'chain'], [74, 44, 7.6, false, 'craft'], [35, 52, 8.8, false, 'craft', true],
    [60, 64, 6.2, true, 'craft'], [18, 72, null, false, 'chain'], [80, 80, 9.3, false, 'craft']]`;
const mapBackdrop = (pins = 'MAP_PINS_ALL') => `h('div', { className: 'mapbg' }, h('div', { className: 'mapbg-river' }),
      ${pins}.map(function (p, i) { return h('span', { key: i, className: 'mapbg-pin', style: { left: p[0] + '%', top: p[1] + '%' } }, h(B.MapCallout, { score: p[2], predicted: p[3], kind: p[4], selected: !!p[5] })); }),
      h('span', { className: 'mapbg-credit' }, '© OpenStreetMap contributors'), h('span', { className: 'mapbg-logo', title: "Google's logo" }), h('span', { className: 'mapbg-terms', title: "Google's terms" }))`;

P.FindBevArt = [{ group: 'Map', height: 280, subtitle: "The Map tab's art" }, '', `
h('div', { className: 'pv', style: { gap: 32, justifyContent: 'center' } },
  L('224 · the Map tab', h(B.FindBevArt, {})),
  L('112', h(B.FindBevArt, { size: 112 })))`];

P.MapCallout = [{ group: 'Map', height: 170, subtitle: 'The venue pin (parked)' }, `.pv { gap: 28px; align-items: flex-end; padding: 32px 16px 24px; background: color-mix(in srgb, var(--input) 65%, var(--surface)); }`, `
h('div', { className: 'pv' },
  L('craft', h(B.MapCallout, { score: 8.8, kind: 'craft' })),
  L('chain', h(B.MapCallout, { score: 9.1, kind: 'chain' })),
  L('predicted', h(B.MapCallout, { score: 7.6, predicted: true, kind: 'craft' })),
  L('no score yet', h(B.MapCallout, { kind: 'chain' })),
  L('selected', h(B.MapCallout, { score: 8.4, kind: 'craft', selected: true })))`];

P.MapFilterRow = [{ group: 'Map', height: 200, width: 393 }, `.cap { margin: 0 16px; padding-top: 14px; font-size: 12px; line-height: 16px; color: var(--textSecondary); }`, `
h('div', { className: 'pv-narrow' },
  h('p', { className: 'cap' }, 'Nothing picked'),
  h(B.MapFilterRow, {}),
  h('p', { className: 'cap' }, 'Two filters on; no neighborhoods yet, so no Neighborhood pill'),
  h(B.MapFilterRow, { count: 2, neighborhoods: false, price: '$, $$', openNow: true }),
  h('p', { className: 'cap' }, 'Scrolled: Category and Retailer picked'),
  h(B.MapFilterRow, { count: 2, neighborhood: '', category: 'Coffee +1', retailer: 'Craft' }))`];

P.MapControls = [{ group: 'Map', height: 560, width: 802, subtitle: 'Inline and full screen' }, MAP_CSS + `.two { display: flex; gap: 16px; padding: 10px; } .frame { position: relative; width: 377px; height: 520px; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; }`, `
(function () {
  var MAP_PINS_ALL = ${MAP_PINS};
  return h('div', { className: 'two' },
    h('div', { className: 'frame' }, ${mapBackdrop()},
      h(B.MapControls, {}, h(B.MapFilterRow, { neighborhoods: false }))),
    h('div', { className: 'frame' }, ${mapBackdrop()},
      h(B.MapControls, { expanded: true, mode: 'map', located: true }, h(B.MapFilterRow, { count: 1, neighborhoods: false, openNow: true }))));
})()`];

P.VenueRow = [{ group: 'Map', height: 300, width: 393, subtitle: "The map's List view" }, '', `
h('div', { className: 'pv-narrow' },
  h(B.VenueRow, { venue: { name: 'Yorkville Coffee Works', kind: 'craft', neighborhood: 'Yorkville' }, openNow: true, score: 8.8, bevs: 3 }),
  h(B.VenueRow, { venue: { name: 'Duane Reade', kind: 'chain' }, openNow: false, score: 9.1, bevs: 6 }),
  h(B.VenueRow, { venue: { name: 'Lexington Deli', kind: 'craft', neighborhood: 'Upper East Side' }, openNow: null, score: 6.2, predicted: true, bevs: 1 }))`];

P.VenueSheet = [{ group: 'Map', height: 1480, width: 393, subtitle: 'Docked under the full-screen map' }, MAP_CSS + `.frame { position: relative; display: flex; flex-direction: column; width: 377px; margin: 10px 8px; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; }
.frame .map { position: relative; flex: none; height: 230px; } .frame .bv-venuesheet { flex: 1; }
.cap { margin: 14px 16px 0; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--textSecondary); }`, `
(function () {
  var MAP_PINS_ALL = [[50, 62, 8.8, false, 'craft', true], [20, 40, 9.1, false, 'chain'], [80, 30, 7.4, false, 'craft']];
  var venue = { name: 'Yorkville Coffee Works', kind: 'craft', neighborhood: 'Yorkville', borough: 'Manhattan', address: '1512 2nd Avenue', website: 'https://yorkvillecoffee.example' };
  var rows = [
    { bev: BEVS.coldBrew, score: 9.1, meta: 'Your score' },
    { bev: BEVS.matcha, score: 8.2, scoreVariant: 'predicted', meta: "You'd rate it", saved: true },
    { bev: BEVS.horchata, score: 7.4, count: 362 }];
  return h(F, null,
    h('p', { className: 'cap' }, 'Loaded'),
    h('div', { className: 'frame', style: { height: 760 } }, h('div', { className: 'map' }, ${mapBackdrop()}), h(B.VenueSheet, { venue: venue, openNow: true, bevs: rows })),
    h('p', { className: 'cap' }, 'Loading: the pin fills the header'),
    h('div', { className: 'frame', style: { height: 380 } }, h(B.VenueSheet, { venue: { name: 'Duane Reade', kind: 'chain', borough: 'Manhattan', address: '1498 York Avenue' }, openNow: null, bevCount: 6, loading: true })),
    h('p', { className: 'cap' }, 'Gone since the pin was drawn'),
    h('div', { className: 'frame', style: { height: 250 } }, h(B.VenueSheet, { notFound: true })));
})()`];

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
    h('div', { className: 'bv-bevof-pair' },
      h(B.BevOfCard, { period: 'day', bev: BEVS.horchata, score: 8.9 }),
      h(B.BevOfCard, { period: 'week', bev: BEVS.topo, score: 8.4 })),
    h(B.SegmentedTabs, { tabs: [{ id: 'feed', label: 'Your feed' }, { id: 'explore', label: 'Explore' }], value: 'feed' }),
    h(B.FeedPost, { actor: FRIENDS[2], bev: BEVS.matcha, score: 8.2, time: '2 days ago', note: 'oat milk, half sweet. the only one I order now',
      liked: true, likeCount: 12, commentCount: 1, comments: [{ author: ARJUN, body: 'need to try this' }], alsoBevdBy: [ARJUN, FRIENDS[1]],
      onLike: function () {}, onComment: function () {}, onRank: function () {}, onSave: function () {} }),
    h(B.FeedPost, { actor: FRIENDS[5], bev: BEVS.coldBrew, score: 9.1, time: '5 hours ago', onLike: function () {}, onComment: function () {}, onRank: function () {}, onSave: function () {} }))`)];

// Lists: Bev'd (left) and Top (right). Bev'd rows carry the app's overflow menu in the foot instead of Rank it and Want to Try.
const LISTS_TOP = (value) => `
    h(B.Header, { centered: true, title: 'Lists' }),
    h('div', { className: 'top' }, h(B.ListScopeDropdown, { label: 'All' })),
    h(B.SegmentedTabs, { tabs: [{ id: 'bevd', label: "Bev'd" }, { id: 'want', label: 'Want to Try' }, { id: 'recommended', label: 'For you' }, { id: 'top', label: 'Top' }], value: '${value}' }),`;
P.ScreenYourLists = [{ group: 'Screens', height: 852, width: 802, isPage: true }, PHONE_CSS + `
  .yl-pair { display: flex; gap: 16px; align-items: flex-start; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; } .filters { display: flex; gap: 10px; padding: 12px 16px 4px; overflow: hidden; }
  .yl-row { position: relative; } .yl-more { position: absolute; right: 8px; bottom: -2px; }`, `
(function () {
  var bevd = function (bev, n, score, meta) {
    return h('div', { className: 'yl-row', key: n }, h(B.BevRow, { bev: bev, number: n, score: score, meta: meta, actions: false }),
      h('span', { className: 'yl-more' }, h(B.IconButton, { icon: 'ellipsis', label: 'More for ' + bev.name })));
  };
  return h('div', { className: 'yl-pair' },
    ${phone('lists', `
  h(F, null,${LISTS_TOP('bevd')}
    h('div', { className: 'filters' }, h(B.FilterPill, { count: 0 }), h(B.FilterPill, { label: 'Bucket', icon: null, chevron: true }), h(B.FilterPill, { label: 'Category', icon: null, chevron: true })),
    h(B.ProgressStrip, { label: 'All Bevs', ranked: 37, total: 378, onClick: function () {} }),
    h(B.SortToggle, { label: 'Score', onClick: function () {}, onSearch: function () {} }),
    bevd(BEVS.horchata, 1, 9.5, 'Ranked Oct 8'),
    bevd(BEVS.dietCoke, 2, 9.3, 'Ranked Oct 3'),
    bevd(BEVS.mexicanCoke, 3, 8.9, 'Ranked Sep 30'),
    bevd(BEVS.topo, 4, 7.9, 'Ranked Sep 26'),
    bevd(BEVS.redBull, 5, 6.1, 'Ranked Sep 22'))`)},
    ${phone('lists', `
  h(F, null,${LISTS_TOP('top')}
    h(B.BevRow, { bev: BEVS.horchata, showImage: true, number: 1, score: 8.9, meta: 'Your score 9.5' }),
    h(B.BevRow, { bev: BEVS.mexicanCoke, showImage: true, number: 2, score: 8.7, meta: 'Your score 8.9' }),
    h(B.BevRow, { bev: BEVS.brownSugar, showImage: true, number: 3, score: 8.5, meta: 'Not ranked yet', saved: true }),
    h(B.BevRow, { bev: BEVS.topo, showImage: true, number: 4, score: 8.4, meta: 'Your score 7.9' }),
    h(B.BevRow, { bev: BEVS.coldBrew, showImage: true, number: 5, score: 8.1, meta: 'Not ranked yet' }),
    h(B.BevRow, { bev: BEVS.matcha, showImage: true, number: 6, score: 8.0, meta: 'Not ranked yet' }),
    h(B.BevRow, { bev: BEVS.dietCoke, showImage: true, number: 7, score: 7.8, meta: 'Your score 9.3' }))`)});
})()`];

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

P.ScreenRankingNote = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .nt-top { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; height: 44px; }
  .nt-reveal { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 16px 4px; text-align: center; }
  .nt-body { display: flex; flex-direction: column; gap: 16px; padding: 16px 16px 0; }
  .nt-kb { position: absolute; left: 0; right: 0; bottom: 0; height: 291px; background: var(--input); border-top: 1px solid var(--border); }`, phone(null, `
  h(F, null,
    h('div', { className: 'nt-top' }, h(B.Button, { variant: 'ghost', size: 'md', icon: 'undo-2' }, 'Undo'), h(B.IconButton, { icon: 'x', label: 'Discard ranking', variant: 'filled' })),
    h('div', { className: 'nt-reveal' },
      h(B.ScoreBubble, { score: 8.9, size: 72 }),
      h('p', { className: 'screenTitle' }, '#4 of 31 in Loved')),
    h('div', { className: 'nt-body' },
      h('p', { className: 'body bv-meta', style: { textAlign: 'center' } }, 'Optional. Your friends see it with your ranking.'),
      h(B.TextField, { label: 'Note', placeholder: 'Tastes like flat Sprite', hint: '0/140', id: 'nt-note' }),
      h(B.Button, { variant: 'primary', block: true }, 'Save'),
      h(B.Button, { variant: 'ghost', block: true }, 'Skip')),
    h('div', { className: 'nt-kb', 'aria-hidden': true }))`)];

P.ScreenGutCheck = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .gc-top { display: flex; justify-content: flex-end; align-items: center; height: 44px; padding: 0 8px; }
  .gc-hero { display: flex; flex-direction: column; align-items: center; padding: 8px 16px 0; text-align: center; }
  .gc-art { width: 200px; height: 200px; }
  .gc-cat { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; }
  .gc-q { margin: 36px 16px 20px; text-align: center; }
  .gc-btns { display: flex; gap: 4px; padding: 0 16px; }
  .gc-hint { margin: 20px 16px 0; text-align: center; }`, `
h('div', { className: 'phone' },
  h('div', { className: 'gc-screen' },
    h('div', { className: 'status' }, '9:41', h('span', { className: 'status-r' }, h('span', { className: 'batt' }, h('i')))),
    h('div', { className: 'gc-top' }, h(B.IconButton, { icon: 'x', label: 'Discard ranking', variant: 'filled' })),
    h('div', { className: 'gc-hero' },
      h('div', { className: 'gc-art' }, h(B.BevArt, BEVS.pamplemousse.art)),
      h('h1', { className: 'screenTitle', style: { marginTop: 12 } }, 'LaCroix Pamplemousse'),
      h('p', { className: 'body bv-meta' }, 'LaCroix'),
      h('p', { className: 'body gc-cat' }, h(B.Icon, { name: 'droplets', size: 16, strokeWidth: 2 }), ' Sparkling water • ', h(B.PriceTier, { tier: 1 }))),
    h('p', { className: 'displayDrop gc-q' }, 'How was it?'),
    h('div', { className: 'gc-btns' }, h(B.BucketButton, { bucket: 'loved', selected: true }), h(B.BucketButton, { bucket: 'fine', dimmed: true }), h(B.BucketButton, { bucket: 'disliked', dimmed: true })),
    h('p', { className: 'caption bv-meta gc-hint' }, "Next, you'll compare it with Bevs you've already ranked.")))`];

// Bev detail scrolls: the first phone is the top of the screen, the second is the same screen
// scrolled to "Bevs like this" (M-27), with the Header held in place as it is in the app.
const bevDetailScreen = (scrollY) => `
  h(F, null,
    h(B.Header, { onBack: function () {}, actions: [{ icon: 'ellipsis', label: 'More' }] }),
    h('div', { className: 'bd-clip' }, h('div', { style: { transform: 'translateY(-${scrollY}px)' } },
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
    h('div', { className: 'bd-like' },
      h(B.SectionHeader, { title: 'Bevs like this' }),
      h(B.BevRow, { bev: BEVS.brownSugar, showImage: true, actions: false, score: 8.5, count: 5120 }),
      h(B.BevRow, { bev: BEVS.matcha, showImage: true, actions: false, score: 8.2, count: 1840 }),
      h(B.BevRow, { bev: BEVS.coldBrew, showImage: true, actions: false, score: 7.9, count: 903 }),
      h(B.BevRow, { bev: BEVS.poppi, showImage: true, actions: false, score: 7.4, count: 212 }),
      h(B.BevRow, { bev: BEVS.oj, showImage: true, actions: false, scoreVariant: 'locked', count: 2, divider: false })),
    h('p', { className: 'caption bv-meta', style: { padding: '24px 16px', textAlign: 'center' } }, 'Added by @acheema5'))))`;

P.ScreenBevDetail = [{ group: 'Screens', height: 852, width: 802, isPage: true }, PHONE_CSS + `
  .bd-pair { display: flex; gap: 16px; align-items: flex-start; }
  .bd-clip { height: 636px; overflow: hidden; }
  .bd-hero { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 16px 16px; text-align: center; }
  .bd-cat { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; }
  .bd-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 10px; }
  .bd-stat { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-stat); text-align: center; }
  .bd-friends { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px; }
  .bd-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 16px; }
  .bd-btns > * { width: 100%; justify-content: center; height: 44px; }
  .bd-like { margin-top: 24px; }`, `
  h('div', { className: 'bd-pair' },
    ${phone('lists', bevDetailScreen(0))},
    ${phone('lists', bevDetailScreen(560))})`];

P.ScreenProfile = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .pf-id { display: flex; flex-direction: column; align-items: center; padding-top: 1px; }
  .pf-counts { display: grid; grid-template-columns: repeat(3, 1fr); padding: 16px 0 0; text-align: center; }
  .pf-counts p { margin: 0; }
  .pf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 20px 16px 0; }
  .pf-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px 10px; }
  .pf-rows { border-top: 1px solid var(--border); }`, phone('profile', `
  h(F, null,
    h(B.Header, { title: 'Matt Willer', actions: [{ icon: 'menu', label: 'Settings' }] }),
    h('div', { className: 'pf-id' },
      h(B.Avatar, { name: ME.name, size: 100 }),
      h('p', { className: 'heading', style: { marginTop: 16, fontWeight: 700 } }, '@mbwiller'),
      h('p', { className: 'body bv-meta' }, 'Member since Oct 2026')),
    h('div', { className: 'pf-counts' },
      h('div', null, h('p', { className: 'heading' }, '42'), h('p', { className: 'body bv-meta' }, "Bev'd")),
      h('div', null, h('p', { className: 'heading' }, '7'), h('p', { className: 'body bv-meta' }, 'Followers')),
      h('div', null, h('p', { className: 'heading' }, '9'), h('p', { className: 'body bv-meta' }, 'Following'))),
    h('div', { className: 'pf-btns' }, h(B.Button, null, 'Edit profile'), h(B.Button, null, 'Share profile')),
    h('div', { className: 'pf-stats' }, h(B.StatCard, { icon: 'trophy', label: 'Rank on Bevi', value: '#12' }), h(B.StatCard, { icon: 'flame', label: 'Current streak', value: '4 days' })),
    h('div', { className: 'pf-rows' },
      h(B.ProfileListRow, { icon: 'bookmark', iconFilled: true, label: 'Want to Try', count: 7 }),
      h(B.ProfileListRow, { icon: 'heart', label: 'Recommended for you' })),
    h(B.SegmentedTabs, { variant: 'underline-icon', tabs: [{ id: 'activity', label: 'Activity', icon: 'file-text' }, { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' }], value: 'activity' }),
    h(B.FeedPost, { you: true, actor: ME, bev: BEVS.dietCoke, score: 9.3, time: 'Wednesday', likeCount: 6, note: 'the fountain one at the dining hall hits different',
      onLike: function () {}, onComment: function () {}, onSave: function () {} }))`)];

// People: pushed from the Feed header's person-plus icon. Search, suggestions, then the points ranking.
P.ScreenPeople = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .pp-q { padding: 4px 16px 4px; }
  .pp-scope { display: flex; gap: 8px; padding: 0 16px 8px; }`, phone('feed', `
  h(F, null,
    h(B.Header, { title: 'People', onBack: function () {} }),
    h('div', { className: 'pp-q' }, h(B.SearchBar, { placeholder: 'Search people', id: 'people-q' })),
    h(B.SectionHeader, { title: 'Suggested for you' }),
    h(B.UserRow, { user: FRIENDS[3], meta: '52 Bevs', context: 'Followed by Sam and Arjun', following: false }),
    h(B.UserRow, { user: FRIENDS[5], meta: '31 Bevs', context: 'Followed by Priya', following: false }),
    h(B.SectionHeader, { title: 'Ranked by points', action: 'How points work', actionLabel: 'How points work' }),
    h('div', { className: 'pp-scope' }, h(B.Pill, { variant: 'outlined', active: true }, 'Friends'), h(B.Pill, { variant: 'outlined' }, 'Everyone')),
    h(B.UserRow, { user: FRIENDS[0], rank: 1, meta: '212 pts · 84 Bevs', streak: 14, following: true }),
    h(B.UserRow, { user: ARJUN, rank: 2, meta: '180 pts · 61 Bevs', streak: 6, following: true }),
    h(B.UserRow, { user: FRIENDS[1], rank: 3, meta: '140 pts · 44 Bevs', streak: 2, following: true }),
    h(B.UserRow, { user: ME, rank: 4, meta: '96 pts · 42 Bevs', streak: 4, self: true }),
    h(B.UserRow, { user: FRIENDS[2], rank: 5, meta: '71 pts · 30 Bevs', following: true }))`)];

// Add Bev (the centre tab): the bar, Snap it, then the fastest routes to ranking something. No map.
const ADD_CSS = PHONE_CSS + `
  .scroll { position: relative; display: flex; flex-direction: column; }
  .ab-q { display: flex; align-items: center; gap: 4px; padding: 4px 16px 12px; } .ab-q .bv-search { flex: 1; }
  .ab-pills { display: flex; gap: 10px; padding: 0 16px 8px; }
  .ab-recent { display: flex; align-items: center; min-height: 60px; padding-left: 16px; }
  .ab-recent-main { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .ab-recent-text { display: flex; flex-direction: column; min-width: 0; }
  .ab-foot { position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--surface); }`;
const ADD_TOP = (value, cancel) => `
    h(B.Header, { title: 'Add a Bev' }),
    h('div', { className: 'ab-q' }, h(B.SearchBar, { variant: 'outlined', placeholder: 'Search a Bev or a person', id: 'add-q'${value ? `, value: '${value}'` : ''} })${cancel ? `, h(B.Button, { variant: 'ghost' }, 'Cancel')` : ''}),
    h('div', { className: 'ab-pills' }, h(B.Pill, { variant: 'filled', icon: 'camera' }, 'Snap it')),`;
const ADD_FOOT = `h('div', { className: 'ab-foot' }, h(B.Button, { variant: 'outlined', block: true, icon: 'circle-plus' }, "Can't find it? Add a new Bev"))`;

P.ScreenAddBev = [{ group: 'Screens', height: 852, width: 393, isPage: true }, ADD_CSS, `
(function () {
  var recent = function (bev) {
    return h('div', { className: 'bv ab-recent bv-divider' },
      h('div', { className: 'ab-recent-main' }, h(B.Icon, { name: 'clock', size: 22, className: 'bv-meta' }),
        h('div', { className: 'ab-recent-text' }, h('p', { className: 'bodyLarge' }, bev.name), h('p', { className: 'body bv-meta' }, bev.brand))),
      h(B.IconButton, { icon: 'x', label: 'Forget ' + bev.name, size: 20 }));
  };
  // The parentheses matter: phone() starts on a new line, and a bare return would end the statement there.
  return (${phone('add', `
  h(F, null,${ADD_TOP('', false)}
    h(B.SectionHeader, { title: 'Recents' }),
    recent(BEVS.redBull),
    recent(BEVS.sprite),
    h(B.SectionHeader, { title: 'Popular on Bevi', action: 'See all' }),
    h(B.BevRow, { bev: BEVS.mexicanCoke, showImage: true, score: 8.7, count: 362 }),
    h(B.BevRow, { bev: BEVS.brownSugar, showImage: true, score: 8.5, count: 5120, saved: true }),
    h(B.BevRow, { bev: BEVS.topo, showImage: true, score: 8.4, count: 97 }),
    h(B.BevRow, { bev: BEVS.coldBrew, showImage: true, score: 8.1, count: 41 }),
    ${ADD_FOOT})`)});
})()`];

P.ScreenSearchResults = [{ group: 'Screens', height: 852, width: 393, isPage: true }, ADD_CSS, phone('add', `
  h(F, null,${ADD_TOP('co', true)}
    h(B.SectionHeader, { title: 'Bevs' }),
    h(B.BevRow, { bev: BEVS.mexicanCoke, showImage: true, score: 8.7, count: 362 }),
    h(B.BevRow, { bev: BEVS.coldBrew, showImage: true, score: 8.1, count: 41, saved: true }),
    h(B.SectionHeader, { title: 'People' }),
    h(B.UserRow, { user: { name: 'Cody Lin', handle: 'codyl' }, following: false }),
    h(B.UserRow, { user: { name: 'Colette Ames', handle: 'colette' }, following: true, divider: false }),
    ${ADD_FOOT})`)];

// Map: for now a doorway to Bev Maps (Find Bev). The in-app map is a later project.
P.ScreenMap = [{ group: 'Screens', height: 852, width: 393, isPage: true }, PHONE_CSS + `
  .scroll { display: flex; flex-direction: column; }
  .fm { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 0 24px 24px; text-align: center; }
  .fm-copy { display: flex; flex-direction: column; gap: 4px; max-width: 280px; margin-top: 8px; }
  .fm-cta { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; }`, phone('map', `
  h(F, null,
    h(B.Header, { title: 'Map' }),
    h('div', { className: 'fm' },
      h(B.FindBevArt, {}),
      h('div', { className: 'fm-copy' },
        h('h1', { className: 'displayDrop' }, 'Find Bev'),
        h('p', { className: 'bodyLarge bv-meta' }, 'Walk to the closest open place to grab a drink.')),
      h('div', { className: 'fm-cta' },
        h(B.Button, { variant: 'primary', block: true, icon: 'navigation' }, 'Find Bev'),
        h('p', { className: 'caption bv-meta' }, 'Opens Bev Maps'))))`)];

for (const [name, [opts, css, code]] of Object.entries(P)) {
  const dir = path.join(ROOT, 'project/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preview.html'), page(name, opts, css, code));
}
console.log('wrote', Object.keys(P).length, 'previews');

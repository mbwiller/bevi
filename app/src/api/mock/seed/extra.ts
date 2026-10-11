// MOCK-ONLY seed data. None of this exists in data/catalog or in the real database: it fills the
// categories the real catalog doesn't cover yet (the catalog is 50 sodas) and gives the mock some
// people, follows and activity so every screen has something to show. Every mock-only Bev id starts
// with `mock-`, every mock user id with `mock-user-`. Photos are null: components fall back to BevArt.

import type { CategoryId, PriceTier } from '@bevi/shared';

export interface ExtraBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  priceTier: PriceTier;
  isStarter: boolean;
  aliases?: string[];
  /** Handle of the mock user who "added" it (for "Added by @handle"). */
  createdBy?: string;
}

const b = (
  id: string,
  name: string,
  brand: string | null,
  flavor: string | null,
  categoryId: CategoryId,
  priceTier: PriceTier,
  isStarter = false,
  extra: Partial<ExtraBev> = {},
): ExtraBev => ({ id: `mock-${id}`, name, brand, flavor, categoryId, priceTier, isStarter, ...extra });

/** ~40 mock-only Bevs across the non-soda categories. 20 non-alcoholic starters, so with the
 * catalog's 13 there are ≥ 30 starter candidates for under-21 users too. */
export const EXTRA_BEVS: readonly ExtraBev[] = [
  // juice
  b('minute-maid-orange', 'Minute Maid Orange Juice', 'Minute Maid', 'Orange', 'juice', 1, true, { aliases: ['oj'] }),
  b('tropicana-apple', 'Tropicana Apple Juice', 'Tropicana', 'Apple', 'juice', 2),
  b('simply-lemonade', 'Simply Lemonade', 'Simply', 'Lemonade', 'juice', 2, true),
  b('ocean-spray-cran-grape', 'Ocean Spray Cran-Grape', 'Ocean Spray', 'Cranberry Grape', 'juice', 1),
  // water
  b('poland-spring', 'Poland Spring', 'Poland Spring', null, 'water', 1, true),
  b('smartwater', 'Smartwater', 'Glaceau', null, 'water', 2, true),
  b('fiji-water', 'Fiji Water', 'Fiji', null, 'water', 2),
  // sparkling water
  b('lacroix-pamplemousse', 'LaCroix Pamplemousse', 'LaCroix', 'Grapefruit', 'sparkling_water', 1, true, { aliases: ['la croix'] }),
  b('topo-chico', 'Topo Chico', 'Topo Chico', 'Original', 'sparkling_water', 2, true),
  b('bubly-lime', 'Bubly Lime', 'Bubly', 'Lime', 'sparkling_water', 1, true),
  b('spindrift-raspberry-lime', 'Spindrift Raspberry Lime', 'Spindrift', 'Raspberry Lime', 'sparkling_water', 2, false, { createdBy: 'priya_k' }),
  // energy
  b('red-bull', 'Red Bull', 'Red Bull', 'Original', 'energy', 2, true),
  b('monster-original', 'Monster Energy', 'Monster', 'Original', 'energy', 2, true),
  b('celsius-sparkling-orange', 'Celsius Sparkling Orange', 'Celsius', 'Orange', 'energy', 2, true),
  b('ghost-sour-patch', 'Ghost Sour Patch Kids Redberry', 'Ghost', 'Redberry', 'energy', 2),
  // coffee
  b('starbucks-frappuccino-mocha', 'Starbucks Frappuccino Mocha', 'Starbucks', 'Mocha', 'coffee', 2, true),
  b('dunkin-iced-coffee', 'Dunkin Iced Coffee', "Dunkin'", 'Original', 'coffee', 2, true),
  b('la-colombe-draft-latte', 'La Colombe Draft Latte', 'La Colombe', 'Oat Milk', 'coffee', 3),
  b('chameleon-cold-brew', 'Chameleon Cold Brew', 'Chameleon', 'Black', 'coffee', 3),
  // tea
  b('arizona-green-tea', 'Arizona Green Tea', 'Arizona', 'Ginseng and Honey', 'tea', 1, true),
  b('snapple-peach', 'Snapple Peach Tea', 'Snapple', 'Peach', 'tea', 1, true),
  b('guayaki-yerba-mate', 'Guayaki Yerba Mate', 'Guayaki', 'Revel Berry', 'tea', 2, true),
  b('pure-leaf-sweet-tea', 'Pure Leaf Sweet Tea', 'Pure Leaf', 'Sweet', 'tea', 1),
  // boba
  b('kung-fu-brown-sugar', 'Kung Fu Tea Brown Sugar Milk', 'Kung Fu Tea', 'Brown Sugar', 'boba', 2, false, { createdBy: 'maya' }),
  b('gong-cha-taro', 'Gong Cha Taro Milk Tea', 'Gong Cha', 'Taro', 'boba', 2),
  b('tiger-sugar-classic', 'Tiger Sugar Classic', 'Tiger Sugar', 'Brown Sugar Boba', 'boba', 3),
  // sports
  b('gatorade-cool-blue', 'Gatorade Cool Blue', 'Gatorade', 'Cool Blue', 'sports', 1, true),
  b('powerade-mountain-berry', 'Powerade Mountain Berry Blast', 'Powerade', 'Mountain Berry Blast', 'sports', 1, true),
  b('bodyarmor-strawberry-banana', 'BodyArmor Strawberry Banana', 'BodyArmor', 'Strawberry Banana', 'sports', 2, true),
  // smoothie
  b('naked-green-machine', 'Naked Green Machine', 'Naked', 'Green Machine', 'smoothie', 2, true),
  b('bolthouse-berry-boost', 'Bolthouse Farms Berry Boost', 'Bolthouse Farms', 'Berry', 'smoothie', 2),
  b('jamba-mango-a-go-go', 'Jamba Mango-a-go-go', 'Jamba', 'Mango', 'smoothie', 3),
  // other
  b('vita-coco', 'Vita Coco Coconut Water', 'Vita Coco', 'Original', 'other', 2, true),
  b('gts-synergy-trilogy', "GT's Synergy Trilogy", "GT's", 'Trilogy', 'other', 2),
  b('health-ade-pink-lady', 'Health-Ade Pink Lady Apple', 'Health-Ade', 'Pink Lady Apple', 'other', 3),
  // beer (alcoholic)
  b('modelo-especial', 'Modelo Especial', 'Modelo', null, 'beer', 2),
  b('guinness-draught', 'Guinness Draught', 'Guinness', 'Stout', 'beer', 2),
  b('sierra-nevada-pale-ale', 'Sierra Nevada Pale Ale', 'Sierra Nevada', 'Pale Ale', 'beer', 2),
  // wine (alcoholic)
  b('kim-crawford-sauv-blanc', 'Kim Crawford Sauvignon Blanc', 'Kim Crawford', 'Sauvignon Blanc', 'wine', 3),
  b('barefoot-pinot-grigio', 'Barefoot Pinot Grigio', 'Barefoot', 'Pinot Grigio', 'wine', 2),
  // spirits & cocktails (alcoholic)
  b('high-noon-pineapple', 'High Noon Pineapple', 'High Noon', 'Pineapple', 'spirits_cocktails', 2),
  b('cutwater-margarita', 'Cutwater Lime Margarita', 'Cutwater', 'Lime Margarita', 'spirits_cocktails', 3),
];

/** An alcoholic mock Bev the conformance suite uses for `age_restricted`. */
export const MOCK_ALCOHOLIC_BEV_ID = 'mock-modelo-especial';

export interface ExtraUser {
  handle: string;
  displayName: string;
  password: string;
  birthdate: string;
  timezone: string;
  /** Days before the fixture build that the account was created. */
  joinedDaysAgo: number;
  /** Category → taste in [-1, 1]; unlisted categories are neutral. */
  taste: Partial<Record<CategoryId, number>>;
  rankings: number;
  /** Consecutive days (ending today) with at least one ranking. */
  streakDays: number;
  follows: string[];
  wantToTry: { bevId: string; via?: string }[];
}

/**
 * The demo account to sign in with, and ~6 fake friends. All passwords are mock-only.
 * `theo` is under 21 (exercises `canSeeAlcohol: false`).
 */
export const DEMO_HANDLE = 'demo';
export const DEMO_PASSWORD = 'demo1234';

export const EXTRA_USERS: readonly ExtraUser[] = [
  {
    handle: DEMO_HANDLE, displayName: 'Demo Drinker', password: DEMO_PASSWORD, birthdate: '1996-04-12',
    timezone: 'America/New_York', joinedDaysAgo: 40, taste: { soda: 0.4, coffee: 0.6, diet_soda: -0.5, sparkling_water: 0.2 },
    rankings: 12, streakDays: 2, follows: ['jules', 'priya_k', 'sam', 'maya'],
    wantToTry: [{ bevId: 'mock-tiger-sugar-classic', via: 'maya' }, { bevId: 'olipop-strawberry-vanilla' }, { bevId: 'mock-topo-chico', via: 'priya_k' }],
  },
  {
    handle: 'jules', displayName: 'Jules Moreau', password: 'password123', birthdate: '1994-09-30',
    timezone: 'America/New_York', joinedDaysAgo: 60, taste: { soda: 0.8, diet_soda: -0.6, energy: 0.3, juice: 0.2 },
    rankings: 55, streakDays: 5, follows: ['priya_k', 'sam', 'demo', 'nina'],
    wantToTry: [{ bevId: 'mock-gong-cha-taro', via: 'maya' }, { bevId: 'reeds-ginger-beer' }],
  },
  {
    handle: 'priya_k', displayName: 'Priya Kapoor', password: 'password123', birthdate: '1998-02-14',
    timezone: 'America/Los_Angeles', joinedDaysAgo: 55, taste: { sparkling_water: 0.9, tea: 0.6, soda: -0.4, diet_soda: 0.3 },
    rankings: 40, streakDays: 3, follows: ['jules', 'maya', 'demo'],
    wantToTry: [{ bevId: 'mock-health-ade-pink-lady' }],
  },
  {
    handle: 'sam', displayName: 'Sam Okafor', password: 'password123', birthdate: '1992-11-03',
    timezone: 'America/Chicago', joinedDaysAgo: 50, taste: { energy: 0.7, sports: 0.6, soda: 0.3, water: -0.3 },
    rankings: 45, streakDays: 0, follows: ['jules', 'theo'],
    wantToTry: [{ bevId: 'mock-ghost-sour-patch', via: 'theo' }],
  },
  {
    handle: 'maya', displayName: 'Maya Chen', password: 'password123', birthdate: '2000-06-21',
    timezone: 'America/Los_Angeles', joinedDaysAgo: 45, taste: { coffee: 0.8, boba: 0.9, tea: 0.4, soda: -0.2 },
    rankings: 35, streakDays: 1, follows: ['priya_k', 'demo', 'nina'],
    wantToTry: [{ bevId: 'mock-la-colombe-draft-latte' }],
  },
  {
    handle: 'theo', displayName: 'Theo Park', password: 'password123', birthdate: '2008-05-01',
    timezone: 'America/Denver', joinedDaysAgo: 30, taste: { energy: 0.6, sports: 0.8, soda: 0.5, juice: 0.3 },
    rankings: 35, streakDays: 4, follows: ['sam', 'jules'],
    wantToTry: [{ bevId: 'mock-celsius-sparkling-orange', via: 'sam' }],
  },
  {
    handle: 'nina', displayName: 'Nina Alvarez', password: 'password123', birthdate: '1990-01-08',
    timezone: 'Europe/London', joinedDaysAgo: 35, taste: { beer: 0.6, wine: 0.7, spirits_cocktails: 0.4, diet_soda: 0.5, soda: -0.3 },
    rankings: 40, streakDays: 0, follows: ['maya', 'jules'],
    wantToTry: [{ bevId: 'mock-cutwater-margarita' }],
  },
];

export interface ExtraFeatured {
  bevId: string;
  tagline: string;
}

/** Featured Bevs (one alcoholic, to exercise the age filter). No hero images in the mock. */
export const EXTRA_FEATURED: readonly ExtraFeatured[] = [
  { bevId: 'olipop-vintage-cola', tagline: 'The cola that started a gut-health craze' },
  { bevId: 'mock-topo-chico', tagline: 'Mineral water with serious bubbles' },
  { bevId: 'mock-kung-fu-brown-sugar', tagline: 'Brown sugar boba, ranked by everyone' },
  { bevId: MOCK_ALCOHOLIC_BEV_ID, tagline: 'A crisp Mexican lager for the 21+ crowd' },
];

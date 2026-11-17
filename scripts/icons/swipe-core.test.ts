import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySwipe, artOf, buildDeck, isAllowedHost, isPrivateAddress, parseManifest, parseSwipe, parseVerdictFile,
  serializeVerdictFile, type Entry, type ManifestRecord, type VerdictFiles,
} from './swipe-core.ts';

const sha = (seed: string) => seed.repeat(64).slice(0, 64);
const record = (slug: string, seed = 'a'): ManifestRecord => ({
  slug, name: slug.toUpperCase(), brand: 'Brand', family: 'can', isStarter: false,
  packageChoice: '12 oz can', uncertainty: 'none',
  references: [{ pageUrl: 'https://example.com/a' }, { pageUrl: 'javascript:alert(1)' }, {}],
  assets: { portableSvg: `portable-svg/${slug}.svg`, portableSvgSha256: sha(seed) },
});
const art = (seed: string) => sha(seed).slice(0, 16);
const entry = (verdict: Entry['verdict'], at: string, seed = 'a', note?: string): Entry => ({ verdict, at, art: art(seed), ...(note ? { note } : {}) });
const pileOf = (records: ManifestRecord[], files: VerdictFiles, slug: string) => buildDeck(records, files).icons.find(i => i.slug === slug)!;

test('an icon nobody has judged is unsorted, in manifest order', () => {
  const deck = buildDeck([record('cola'), record('tea'), record('water')], {});
  assert.deepEqual(deck.icons.map(i => [i.slug, i.pile]), [['cola', 'unsorted'], ['tea', 'unsorted'], ['water', 'unsorted']]);
  assert.deepEqual(deck.counts, { unsorted: 3, good: 0, 'needs-work': 0 });
  assert.deepEqual(deck.icons[0].references, ['https://example.com/a']);
});

test('a verdict stays: the icon is in its pile on every later read', () => {
  const files: VerdictFiles = { matt: { cola: entry('good', '2026-11-14T10:00:00.000Z') }, arjun: { tea: entry('needs-work', '2026-11-14T11:00:00.000Z', 'a', 'label too small') } };
  const records = [record('cola'), record('tea'), record('water')];
  for (let read = 0; read < 2; read++) {
    const deck = buildDeck(records, files);
    assert.deepEqual(deck.counts, { unsorted: 1, good: 1, 'needs-work': 1 });
    assert.deepEqual(deck.icons.map(i => i.slug), ['water', 'cola', 'tea']);
    assert.equal(pileOf(records, files, 'tea').note, 'label too small');
    assert.equal(pileOf(records, files, 'tea').by, 'arjun');
  }
});

test('an icon added to the manifest joins the unsorted pile without disturbing the sorted ones', () => {
  const files: VerdictFiles = { matt: { cola: entry('good', '2026-11-14T10:00:00.000Z') } };
  const deck = buildDeck([record('cola'), record('new-soda')], files);
  assert.equal(deck.icons.find(i => i.slug === 'new-soda')!.pile, 'unsorted');
  assert.equal(deck.icons.find(i => i.slug === 'cola')!.pile, 'good');
});

test('a redrawn icon returns to the deck, first, carrying the verdict it answers', () => {
  const files: VerdictFiles = { matt: { tea: entry('needs-work', '2026-11-14T10:00:00.000Z', 'a', 'cap is the wrong red') } };
  const deck = buildDeck([record('cola'), record('tea', 'b')], files);
  assert.deepEqual(deck.icons.map(i => i.slug), ['tea', 'cola']);
  assert.equal(deck.icons[0].pile, 'unsorted');
  assert.deepEqual(deck.icons[0].previous, { verdict: 'needs-work', by: 'matt', at: '2026-11-14T10:00:00.000Z', note: 'cap is the wrong red' });
  assert.equal(deck.icons[0].by, undefined);
});

test('the piles are shared: the newest verdict from either reviewer decides', () => {
  const records = [record('cola')];
  const files: VerdictFiles = { matt: { cola: entry('good', '2026-11-14T10:00:00.000Z') }, arjun: { cola: entry('needs-work', '2026-11-14T12:00:00.000Z') } };
  assert.equal(pileOf(records, files, 'cola').pile, 'needs-work');
  assert.equal(pileOf(records, files, 'cola').by, 'arjun');
  files.matt!.cola = entry('good', '2026-11-14T13:00:00.000Z');
  assert.equal(pileOf(records, files, 'cola').pile, 'good');
});

test('a swipe writes the reviewer\'s own file only and leaves other icons alone', () => {
  const files: VerdictFiles = { matt: { cola: entry('good', '2026-11-14T10:00:00.000Z') }, arjun: {} };
  const mine = applySwipe(files, { slug: 'tea', verdict: 'needs-work', reviewer: 'matt', art: art('a'), note: 'too dark' }, new Date('2026-11-14T11:00:00.000Z'));
  assert.deepEqual(mine, { cola: entry('good', '2026-11-14T10:00:00.000Z'), tea: entry('needs-work', '2026-11-14T11:00:00.000Z', 'a', 'too dark') });
  assert.deepEqual(files.matt, { cola: entry('good', '2026-11-14T10:00:00.000Z') }, 'the input is not mutated');
});

test('undo leaves no trace when nobody else judged the icon, and outranks the other reviewer when they did', () => {
  const alone: VerdictFiles = { matt: { cola: entry('good', '2026-11-14T10:00:00.000Z') } };
  assert.deepEqual(applySwipe(alone, { slug: 'cola', verdict: 'unsorted', reviewer: 'matt', art: art('a') }, new Date('2026-11-14T10:01:00.000Z')), {});

  const both: VerdictFiles = { matt: {}, arjun: { cola: entry('good', '2026-11-14T10:00:00.000Z') } };
  both.matt = applySwipe(both, { slug: 'cola', verdict: 'unsorted', reviewer: 'matt', art: art('a') }, new Date('2026-11-14T10:01:00.000Z'));
  assert.equal(both.matt.cola.verdict, 'unsorted');
  assert.equal(pileOf([record('cola')], both, 'cola').pile, 'unsorted');
  assert.equal(pileOf([record('cola')], both, 'cola').previous, undefined);
});

test('a swipe wins over an entry stamped by a clock that runs ahead', () => {
  const files: VerdictFiles = { arjun: { cola: entry('good', '2026-11-14T10:05:00.000Z') } };
  files.matt = applySwipe(files, { slug: 'cola', verdict: 'needs-work', reviewer: 'matt', art: art('a') }, new Date('2026-11-14T10:00:00.000Z'));
  assert.equal(files.matt.cola.at, '2026-11-14T10:05:00.001Z');
  assert.equal(pileOf([record('cola')], files, 'cola').pile, 'needs-work');
});

test('a verdict file round-trips, one icon per line, slugs sorted', () => {
  const entries = { tea: entry('needs-work', '2026-11-14T11:00:00.000Z', 'a', 'says "diet", should not'), cola: entry('good', '2026-11-14T10:00:00.000Z') };
  const text = serializeVerdictFile('matt', entries);
  assert.deepEqual(parseVerdictFile(text), entries);
  const lines = text.split('\n');
  assert.equal(lines.length, 8);
  assert.match(lines[3], /^ {4}"cola": \{"verdict":"good"/);
  assert.match(lines[4], /^ {4}"tea": \{"verdict":"needs-work"/);
  assert.deepEqual(parseVerdictFile(serializeVerdictFile('arjun', {})), {});
});

test('a damaged entry in a verdict file is dropped, the rest is kept', () => {
  const text = JSON.stringify({ reviewer: 'matt', verdicts: {
    cola: entry('good', '2026-11-14T10:00:00.000Z'),
    tea: { verdict: 'great', at: '2026-11-14T10:00:00.000Z', art: art('a') },
    water: { verdict: 'good', at: 'yesterday', art: art('a') },
    juice: { verdict: 'good', at: '2026-11-14T10:00:00.000Z', art: 'short' },
    '../etc': entry('good', '2026-11-14T10:00:00.000Z'),
  } });
  assert.deepEqual(Object.keys(parseVerdictFile(text)), ['cola']);
  assert.deepEqual(parseVerdictFile('{}'), {});
  assert.throws(() => parseVerdictFile('<<<<<<< HEAD'));
});

test('the manifest reader keeps showable records and refuses a file without records', () => {
  const good = record('cola');
  const records = parseManifest(JSON.stringify({ records: [good, { slug: '../x', name: 'x', assets: good.assets }, { slug: 'no-assets', name: 'x' }] }));
  assert.deepEqual(records.map(r => r.slug), ['cola']);
  assert.equal(artOf(records[0]), art('a'));
  assert.throws(() => parseManifest('{}'), /no records/);
});

test('a request body is a swipe only when every field is what the deck would send', () => {
  const ok = { slug: 'cola', verdict: 'good', reviewer: 'matt', art: art('a') };
  assert.deepEqual(parseSwipe(ok), ok);
  assert.deepEqual(parseSwipe({ ...ok, verdict: 'needs-work', note: '  too dark  ' }), { ...ok, verdict: 'needs-work', note: 'too dark' });
  assert.deepEqual(parseSwipe({ ...ok, note: '   ' }), ok);
  for (const bad of [null, 'x', { ...ok, slug: '../../etc/passwd' }, { ...ok, slug: 'Cola' }, { ...ok, verdict: 'great' },
    { ...ok, reviewer: 'mallory' }, { ...ok, art: 'xyz' }, { ...ok, note: 'x'.repeat(501) }, { ...ok, note: 7 }]) {
    assert.equal(typeof parseSwipe(bad), 'string', JSON.stringify(bad));
  }
});

test('only peers on a private network are served', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.16.4.1', '172.31.255.255', '169.254.10.1', '100.64.0.1', 'fe80::1c2a:3bff:fe4d:5e6f%en0', 'fd12:3456::1']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of [undefined, '', '8.8.8.8', '172.32.0.1', '192.169.1.1', '100.128.0.1', '2607:f8b0::1', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(a), false, String(a));
  }
});

test('the Host header must be an address or this machine\'s own name, on the right port', () => {
  const names = ['matts-mac', 'matts-mac.local'];
  for (const host of ['localhost:4318', '127.0.0.1:4318', '192.168.1.20:4318', 'Matts-Mac.local:4318', 'matts-mac:4318', '[::1]:4318']) {
    assert.equal(isAllowedHost(host, 4318, names), true, host);
  }
  for (const host of [undefined, '', 'evil.example:4318', 'localhost:4317', 'localhost', '8.8.8.8:4318', 'other-mac.local:4318', 'localhost:4318@evil.example']) {
    assert.equal(isAllowedHost(host, 4318, names), false, String(host));
  }
});

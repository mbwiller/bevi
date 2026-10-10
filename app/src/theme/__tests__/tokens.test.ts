import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bucketForScore } from '@bevi/ranking';

import { colors, radius, size, spacing, type } from '../tokens';
import { scoreColor } from '../score';

// The design system is the source of truth; these tests fail when app tokens drift from it.
const ds = JSON.parse(readFileSync(join(__dirname, '../../../../design/system/project/tokens.json'), 'utf8'));

const px = (v: string) => Number(v.replace('px', ''));
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

describe('tokens match design/system/project/tokens.json', () => {
  it('has every colour, in both themes, with the same value', () => {
    const names = ds.color.tokens.map((t: { name: string }) => t.name).sort();
    expect(Object.keys(colors.light).sort()).toEqual(names);
    expect(Object.keys(colors.dark).sort()).toEqual(names);
    for (const t of ds.color.tokens) {
      const [l, d] = typeof t.value === 'string' ? [t.value, t.value] : [t.value.light, t.value.dark];
      expect([t.name, colors.light[t.name as keyof typeof colors.light]]).toEqual([t.name, l]);
      expect([t.name, colors.dark[t.name as keyof typeof colors.dark]]).toEqual([t.name, d]);
    }
  });

  it.each([
    ['spacing', 'space-', spacing],
    ['radius', 'radius-', radius],
    ['size', 'size-', size],
  ] as const)('%s', (group, prefix, ours) => {
    const theirs = Object.fromEntries(
      ds[group].tokens.map((t: { name: string; value: string }) => [camel(t.name.slice(prefix.length)), px(t.value)]),
    );
    expect(ours).toEqual(theirs);
  });

  it('type scale', () => {
    const app = ds.type.groups.find((g: { name: string }) => g.name === 'App');
    const theirs = Object.fromEntries(
      app.styles.map((s: Record<string, string | number>) => [
        s.name,
        {
          fontSize: px(String(s.fontSize)),
          lineHeight: px(String(s.lineHeight)),
          fontWeight: String(s.fontWeight),
          ...(s.letterSpacing ? { letterSpacing: px(String(s.letterSpacing)) } : {}),
        },
      ]),
    );
    const ours = Object.fromEntries(
      Object.entries(type).map(([k, v]) => {
        const { textTransform: _t, ...rest } = v as Record<string, unknown>;
        return [k, rest];
      }),
    );
    expect(ours).toEqual(theirs);
  });
});

describe('scoreColor', () => {
  it('uses the bucket when known, so a Fine Bev at the top edge stays amber', () => {
    expect(scoreColor(6.99, 'FINE')).toBe('scoreMid');
    expect(scoreColor(7.0, 'FINE')).toBe('scoreMid');
  });
  it('otherwise follows @bevi/ranking bands', () => {
    expect(bucketForScore(7)).toBe('LOVED');
    expect(scoreColor(7)).toBe('scoreHigh');
    expect(scoreColor(6.99)).toBe('scoreMid');
    expect(scoreColor(4)).toBe('scoreMid');
    expect(scoreColor(3.99)).toBe('scoreLow');
  });
});

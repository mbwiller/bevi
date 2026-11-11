import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDGE_STRIP } from '@/components/StatusBarClearance';
import { COLUMN_MAX_WIDTH } from '@/lib/column';
import { colors } from '@/theme';

const publicDir = join(__dirname, '../../public');
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;

function themeColor(scheme: 'light' | 'dark'): string | undefined {
  const re = new RegExp(`<meta name="theme-color" media="\\(prefers-color-scheme: ${scheme}\\)" content="([^"]+)"`);
  return re.exec(html)?.[1];
}

function resetCss(): string {
  return /<style id="expo-reset">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

describe('theme-color metas', () => {
  it('match the surface token in each theme', () => {
    expect(themeColor('light')).toBe(colors.light.surface);
    expect(themeColor('dark')).toBe(colors.dark.surface);
  });
});

describe('html and body background', () => {
  it('is surface, with a dark-scheme override', () => {
    const css = resetCss();
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*html,\s*body\s*\{\s*background-color:\s*([^;]+);/.exec(css);
    const base = /html,\s*body\s*\{[^}]*?background-color:\s*([^;]+);/.exec(css);
    expect(base?.[1]).toBe(colors.light.surface);
    expect(dark?.[1]).toBe(colors.dark.surface);
  });

  it('declares both colour schemes', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
  });
});

describe('manifest', () => {
  it('has no theme_color (the metas cover both themes)', () => {
    expect(manifest).not.toHaveProperty('theme_color');
  });
});

describe('status-bar-style script', () => {
  const src = /<script id="status-bar-style">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  function run(darkMatches: boolean): string {
    const meta = {
      content: 'default',
      setAttribute(name: string, value: string) {
        if (name === 'content') this.content = value;
      },
    };
    const document = { querySelector: () => meta };
    const matchMedia = (q: string) => ({ matches: darkMatches && q.includes('dark') });
    new Function('window', 'document', src)({ matchMedia }, document);
    return meta.content;
  }

  it('is present', () => {
    expect(src).not.toBe('');
  });

  it('switches to the opaque black bar when dark matches', () => {
    expect(run(true)).toBe('black');
  });

  it('never asks for black-translucent (iOS 26 lays a new install out one status bar short of the screen)', () => {
    expect(html).not.toMatch(/content=["']black-translucent["']|'black-translucent'/);
  });

  it('stays default otherwise', () => {
    expect(run(false)).toBe('default');
  });
});

describe('edge strip', () => {
  const css = resetCss();

  it('is in the body, outside the React root', () => {
    expect(html).toMatch(/<div id="edge-strip" aria-hidden="true"><\/div>\s*<div id="root">/);
  });

  it('is hidden except in the iOS home-screen app in portrait', () => {
    expect(css).toMatch(/#edge-strip\s*\{\s*display:\s*none;/);
    // Every rule that shows it sits inside the iOS-only @supports block (Android and desktop installs have no clearance).
    const ios = css.slice(css.indexOf('@supports (-webkit-touch-callout: none) {'));
    expect(css.indexOf('@supports (-webkit-touch-callout: none) {')).toBeGreaterThan(-1);
    expect(css.indexOf('@media (display-mode: standalone)')).toBeGreaterThan(css.indexOf('@supports (-webkit-touch-callout: none) {'));
    expect(ios).toContain('@media (display-mode: standalone) and (orientation: portrait) {');
  });

  it('is fixed to the top edge, full width, EDGE_STRIP tall, and lets taps through', () => {
    const rule = /@media \(display-mode: standalone\) and \(orientation: portrait\) \{\s*#edge-strip \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('top: 0;');
    expect(rule).toContain('left: 0;');
    expect(rule).toContain('right: 0;');
    expect(rule).toContain(`height: max(${EDGE_STRIP}px, env(safe-area-inset-top));`);
    expect(rule).toContain('pointer-events: none;');
    expect(rule).toContain(`background-color: ${colors.light.surface};`);
  });

  it('is the dark surface in dark mode', () => {
    const dark = /@media \(display-mode: standalone\) and \(orientation: portrait\) and \(prefers-color-scheme: dark\) \{\s*#edge-strip \{\s*background-color:\s*([^;]+);/.exec(css);
    expect(dark?.[1]).toBe(colors.dark.surface);
  });
});

describe('the centred column on a wide viewport', () => {
  const css = resetCss();
  const wide = `@media (min-width: ${COLUMN_MAX_WIDTH + 1}px) and (min-height: ${COLUMN_MAX_WIDTH + 1}px)`;
  const block = (start: string) => {
    const i = css.indexOf(start);
    expect(i).toBeGreaterThan(-1);
    // Up to the next @media (or the end): the block's rules.
    const next = css.indexOf('@media', i + start.length);
    return css.slice(i, next === -1 ? undefined : next);
  };
  const rule = (src: string, selector: string) => {
    const at = src.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('}', at));
  };

  it('uses the same numbers as lib/column.ts, so no phone in either orientation matches', () => {
    expect(css).toContain(`${wide} {`);
    expect(css).toContain(`${wide} and (prefers-color-scheme: dark) {`);
  });

  it('caps #root at the column width, centred, on surface, with the quiet input fill around it', () => {
    const light = block(`${wide} {`);
    expect(rule(light, '#root')).toContain(`max-width: ${COLUMN_MAX_WIDTH}px;`);
    expect(rule(light, '#root')).toContain('margin: 0 auto;');
    expect(rule(light, '#root')).toContain(`background-color: ${colors.light.surface};`);
    expect(rule(light, 'body')).toContain(`background-color: ${colors.light.input};`);
    const dark = block(`${wide} and (prefers-color-scheme: dark) {`);
    expect(rule(dark, '#root')).toContain(`background-color: ${colors.dark.surface};`);
    expect(rule(dark, 'body')).toContain(`background-color: ${colors.dark.input};`);
  });

  it('gives a Modal portal (a bare div on body) the column box and makes it the containing block of its fixed layers', () => {
    const portal = rule(block(`${wide} {`), 'body > div:not([id]):not([class])');
    for (const decl of ['position: fixed;', 'top: 0;', 'bottom: 0;', 'left: 0;', 'right: 0;', `max-width: ${COLUMN_MAX_WIDTH}px;`, 'margin: 0 auto;', 'transform: translateZ(0);', 'pointer-events: none;']) {
      expect(portal).toContain(decl);
    }
    // Above #root's positioned layers, as the Modal's own container is.
    expect(portal).toContain('z-index: 9999;');
    // What an open portal holds takes clicks again, at zero specificity.
    expect(rule(block(`${wide} {`), ':where(body > div:not([id]):not([class])) > *')).toContain('pointer-events: auto;');
  });

  it('matches neither #root nor #edge-strip with the portal selector (both have ids)', () => {
    expect(html).toMatch(/<div id="edge-strip"[^>]*><\/div>\s*<div id="root"><\/div>/);
  });
});

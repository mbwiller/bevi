import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDGE_STRIP } from '@/components/StatusBarClearance';
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

  it('is hidden except in the home-screen app in portrait', () => {
    expect(css).toMatch(/#edge-strip\s*\{\s*display:\s*none;/);
    expect(css).toContain('@media (display-mode: standalone) and (orientation: portrait) {');
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

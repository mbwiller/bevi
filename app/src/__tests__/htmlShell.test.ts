import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('switches to black-translucent when dark matches', () => {
    expect(run(true)).toBe('black-translucent');
  });

  it('stays default otherwise', () => {
    expect(run(false)).toBe('default');
  });
});

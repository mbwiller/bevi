import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Matt's rule: the mock is removable. Nothing outside app/src/api/mock/ imports from it except
// app/src/api/client.ts. Catches static, side-effect and dynamic imports, require() and jest.mock().

const SRC = resolve(__dirname, '../..');
const MOCK_DIR = resolve(SRC, 'api/mock');
const ALLOWED = new Set([resolve(SRC, 'api/client.ts'), __filename]);

/** Module specifiers in `from '…'`, `import '…'`, `import('…')`, `require('…')`, `jest.mock('…')` & co. */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire(?:\.resolve)?\s*\(\s*|\bjest\.(?:mock|doMock|unmock|dontMock|requireActual|requireMock|createMockFromModule)\s*\(\s*)(['"`])([^'"`]+)\1/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.[cm]?[jt]sx?$/.test(name) ? [p] : [];
  });
}

/** Where a specifier points inside src/, or null for packages. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return resolve(SRC, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(file), spec);
  return null;
}

const insideMock = (p: string) => p === MOCK_DIR || p.startsWith(MOCK_DIR + sep);

function mockImports(file: string, text: string): string[] {
  return [...text.matchAll(SPECIFIER)]
    .map((m) => m[2]!)
    .filter((spec) => {
      const t = target(file, spec);
      return t !== null && insideMock(t);
    });
}

it('only client.ts imports from app/src/api/mock', () => {
  const offenders = walk(SRC)
    .filter((file) => !insideMock(file) && !ALLOWED.has(file))
    .flatMap((file) => mockImports(file, readFileSync(file, 'utf8')).map((spec) => `${relative(SRC, file)} → ${spec}`));
  expect(offenders).toEqual([]);
});

it('recognises every kind of import', () => {
  const file = resolve(SRC, 'app/screen.tsx');
  const kinds = [
    "import { MockApi } from '@/api/mock';",
    "import '@/api/mock/seed/extra';",
    "const m = await import('../api/mock/controls');",
    "const m = require('@/api/mock');",
    "jest.mock('@/api/mock/MockApi', () => ({}));",
    "export * from '../api/mock';",
  ];
  for (const line of kinds) expect(mockImports(file, line)).toHaveLength(1);
  expect(mockImports(file, "import { api } from '@/api/client';")).toEqual([]);
  expect(mockImports(file, "import data from './mockData';")).toEqual([]);
});

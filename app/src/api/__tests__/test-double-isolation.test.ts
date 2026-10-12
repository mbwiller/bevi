import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// The in-memory FakeApi and its fixture people are test-only. No production file (anything outside
// src/testing/, __tests__/ and *.test.*) may import src/testing/**, so none of it can reach the app
// bundle. Catches static, side-effect and dynamic imports, require() and jest.mock().

const SRC = resolve(__dirname, '../..');
const TESTING_DIR = resolve(SRC, 'testing');

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

const insideTesting = (p: string) => p === TESTING_DIR || p.startsWith(TESTING_DIR + sep);
const isTestFile = (p: string) => p.split(sep).includes('__tests__') || /\.test\.[cm]?[jt]sx?$/.test(p);

function testingImports(file: string, text: string): string[] {
  return [...text.matchAll(SPECIFIER)]
    .map((m) => m[2]!)
    .filter((spec) => {
      const t = target(file, spec);
      return t !== null && insideTesting(t);
    });
}

it('no production file imports src/testing', () => {
  const offenders = walk(SRC)
    .filter((file) => !insideTesting(file) && !isTestFile(file))
    .flatMap((file) => testingImports(file, readFileSync(file, 'utf8')).map((spec) => `${relative(SRC, file)} → ${spec}`));
  expect(offenders).toEqual([]);
});

it('recognises every kind of import', () => {
  const file = resolve(SRC, 'app/screen.tsx');
  const kinds = [
    "import { FakeApi } from '@/testing/fakeApi';",
    "import '@/testing/fakeApi/people';",
    "const m = await import('../testing/fakeApi/controls');",
    "const m = require('@/testing/fakeApi');",
    "jest.mock('@/testing/fakeApi/FakeApi', () => ({}));",
    "export * from '../testing/fakeApi';",
  ];
  for (const line of kinds) expect(testingImports(file, line)).toHaveLength(1);
  expect(testingImports(file, "import { api } from '@/api/client';")).toEqual([]);
  expect(testingImports(file, "import data from './testingData';")).toEqual([]);
});

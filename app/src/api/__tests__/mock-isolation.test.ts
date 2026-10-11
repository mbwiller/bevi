import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Matt's rule: the mock is removable. Nothing outside app/src/api/mock/ imports from it except
// app/src/api/client.ts (and this folder's own tests).

const SRC = resolve(__dirname, '../..');
const MOCK_DIR = resolve(SRC, 'api/mock');
const ALLOWED = new Set([resolve(SRC, 'api/client.ts')]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(t|j)sx?$/.test(name) ? [p] : [];
  });
}

it('only client.ts imports from app/src/api/mock', () => {
  const offenders = walk(SRC)
    .filter((file) => !file.startsWith(MOCK_DIR) && !ALLOWED.has(file))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /from\s+['"][^'"]*(\/api\/mock|\.\/mock|\.\.\/mock)(\/[^'"]*)?['"]|require\(\s*['"][^'"]*\/mock(\/[^'"]*)?['"]/.test(text);
    })
    .map((file) => relative(SRC, file));
  expect(offenders).toEqual([]);
});

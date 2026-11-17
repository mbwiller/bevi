// `npm run icons:swipe` — a local server for sorting every authored Bev icon
// into Good or Needs work by swiping, on this Mac and on phones on the same
// Wi-Fi. It reads design/beverage-icons/manifest.json on every request, so an
// icon that a build or a `git pull` adds shows up in the deck without a
// restart. Verdicts are written to design/beverage-icons/verdicts/<reviewer>.json.
//
//   npm run icons:swipe              serve on the local network and open the browser
//   npm run icons:swipe -- --local   this Mac only
//   npm run icons:swipe -- --no-open do not open a browser
//   ICON_SWIPE_PORT=5000             another port (default 4318)
//   ICON_SWIPE_VERDICTS_DIR=/tmp/x   write verdicts elsewhere (for trying things out)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import {
  REVIEWERS, applySwipe, artOf, buildDeck, isAllowedHost, isPrivateAddress, isSlug, parseManifest, parseSwipe,
  parseVerdictFile, serializeVerdictFile,
  type Entry, type ManifestRecord, type Reviewer, type VerdictFiles,
} from './swipe-core.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const iconsDir = join(root, 'design/beverage-icons');
const verdictsDir = resolve(process.env.ICON_SWIPE_VERDICTS_DIR ?? join(iconsDir, 'verdicts'));
const staticDir = fileURLToPath(new URL('./swipe/', import.meta.url));
const fontsDir = join(root, 'design/system/project/fonts');
const port = Number(process.env.ICON_SWIPE_PORT ?? 4318);
const localOnly = process.argv.includes('--local');
const machine = hostname().toLowerCase().replace(/\.local$/, '');
const names = [machine, `${machine}.local`];

const STATIC: Record<string, [dir: string, file: string, type: string]> = {
  '/': [staticDir, 'index.html', 'text/html; charset=utf-8'],
  '/app.mjs': [staticDir, 'app.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': [staticDir, 'style.css', 'text/css; charset=utf-8'],
  '/fonts/Fredoka-SemiBold.woff2': [fontsDir, 'Fredoka-SemiBold.woff2', 'font/woff2'],
  '/fonts/Fredoka-Bold.woff2': [fontsDir, 'Fredoka-Bold.woff2', 'font/woff2'],
};

// Files are re-read only when their size or mtime changes, so the client's
// five-second poll costs a few stat calls.
const cache = new Map<string, { key: string; value: unknown }>();
async function cached<T>(path: string, parse: (text: string) => T, missing: T): Promise<T> {
  let key: string;
  try { const s = await stat(path); key = `${s.size}:${s.mtimeMs}`; } catch { cache.delete(path); return missing; }
  const hit = cache.get(path);
  if (hit?.key === key) return hit.value as T;
  const value = parse(await readFile(path, 'utf8'));
  cache.set(path, { key, value });
  return value;
}

// A build rewrites manifest.json in place, so a request can catch it half
// written. Keep serving the last manifest that parsed and say so.
let lastRecords: ManifestRecord[] | undefined;
async function readRecords(): Promise<{ records: ManifestRecord[]; warning?: string }> {
  try {
    lastRecords = await cached(join(iconsDir, 'manifest.json'), parseManifest, [] as ManifestRecord[]);
    return { records: lastRecords };
  } catch (error) {
    if (!lastRecords) throw error;
    return { records: lastRecords, warning: 'manifest.json could not be read just now; showing the last good copy.' };
  }
}
const verdictPath = (reviewer: Reviewer) => join(verdictsDir, `${reviewer}.json`);
async function readVerdicts(): Promise<VerdictFiles> {
  const files: VerdictFiles = {};
  for (const reviewer of REVIEWERS) files[reviewer] = await cached(verdictPath(reviewer), parseVerdictFile, {} as Record<string, Entry>);
  return files;
}
async function deckJson(): Promise<string> {
  const { records, warning } = await readRecords();
  return JSON.stringify({ ...buildDeck(records, await readVerdicts()), ...(warning ? { warning } : {}) });
}

// One write at a time: two phones swiping at once must not interleave a
// read-modify-write of the same file.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 8192) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  response.writeHead(status, headers).end(body);
}
const json = (response: ServerResponse, status: number, value: unknown) =>
  send(response, status, JSON.stringify(value), { 'Content-Type': 'application/json' });

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  response.setHeader('Cache-Control', 'no-store');
  if (!isPrivateAddress(request.socket.remoteAddress) || !isAllowedHost(request.headers.host, port, names)) { send(response, 403, ''); return; }
  const origin = `http://${request.headers.host}`;
  if (request.headers.origin && request.headers.origin !== origin) { send(response, 403, ''); return; }
  const url = new URL(request.url ?? '/', origin);

  if (request.method === 'POST' && url.pathname === '/api/verdict') {
    // A JSON content type cannot be sent cross-site without a preflight, which this server never answers.
    if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) { json(response, 415, { error: 'send application/json' }); return; }
    let body: unknown;
    try { body = await readBody(request); } catch { json(response, 400, { error: 'body is not JSON' }); return; }
    const swipe = parseSwipe(body);
    if (typeof swipe === 'string') { json(response, 400, { error: swipe }); return; }
    const result = await serial(async () => {
      const { records } = await readRecords();
      const record = records.find(r => r.slug === swipe.slug);
      if (!record) return { status: 404, error: 'no such icon in the manifest' };
      // The verdict is on the art the reviewer was looking at. If the icon was rebuilt meanwhile, show them the new one.
      if (artOf(record) !== swipe.art) return { status: 409, error: 'this icon was redrawn a moment ago; have another look' };
      const entries = applySwipe(await readVerdicts(), swipe, new Date());
      await mkdir(verdictsDir, { recursive: true });
      const path = verdictPath(swipe.reviewer);
      await writeFile(`${path}.tmp`, serializeVerdictFile(swipe.reviewer, entries));
      await rename(`${path}.tmp`, path);
      return { status: 200 };
    });
    const deck = await deckJson();
    if (result.status === 200) send(response, 200, deck, { 'Content-Type': 'application/json' });
    else json(response, result.status, { error: result.error, deck: JSON.parse(deck) });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { send(response, 405, ''); return; }

  if (url.pathname === '/api/deck') {
    const body = await deckJson();
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    if (request.headers['if-none-match'] === etag) { send(response, 304, '', { ETag: etag }); return; }
    send(response, 200, body, { 'Content-Type': 'application/json', ETag: etag });
    return;
  }
  const icon = /^\/icons\/([^/]+)\.svg$/.exec(url.pathname);
  if (icon && isSlug(icon[1])) {
    const { records } = await readRecords();
    const record = records.find(r => r.slug === icon[1]);
    // The path comes from the manifest, never from the URL; only files under portable-svg/ are served.
    const path = record && resolve(iconsDir, record.assets.portableSvg);
    if (!path || !path.startsWith(join(iconsDir, 'portable-svg') + '/')) { send(response, 404, ''); return; }
    try {
      const bytes = await readFile(path);
      // `?v=<art>` names one version of the art, so it can be cached for good; a redraw gets a new URL.
      const fresh = url.searchParams.get('v') === artOf(record);
      send(response, 200, bytes, {
        'Content-Type': 'image/svg+xml',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': fresh ? 'private, max-age=31536000, immutable' : 'no-store',
      });
    } catch { send(response, 404, ''); }
    return;
  }
  const file = STATIC[url.pathname];
  if (!file) { send(response, 404, ''); return; }
  send(response, 200, await readFile(join(file[0], file[1])), { 'Content-Type': file[2] });
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    console.error(error);
    if (response.headersSent) response.end(); else json(response, 500, { error: error instanceof Error ? error.message : 'server error' });
  });
});
server.on('error', error => {
  console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ? `Port ${port} is in use. Is the tool already running? Otherwise: ICON_SWIPE_PORT=<port> npm run icons:swipe`
    : error);
  process.exit(1);
});
server.listen(port, localOnly ? '127.0.0.1' : '0.0.0.0', async () => {
  const local = `http://localhost:${port}`;
  const { records } = await readRecords().catch(() => ({ records: [] as ManifestRecord[] }));
  console.log(`\nBevi icon swipe · ${records.length} icons · verdicts in ${verdictsDir}\n`);
  console.log(`  On this Mac     ${local}`);
  if (!localOnly) {
    console.log(`  On your phone   http://${names[1]}:${port}   (same Wi-Fi)`);
    for (const list of Object.values(networkInterfaces())) {
      for (const address of list ?? []) {
        if (address.family === 'IPv4' && !address.internal) console.log(`                  http://${address.address}:${port}`);
      }
    }
  }
  console.log('\nCtrl-C to stop.\n');
  if (process.platform === 'darwin' && !process.argv.includes('--no-open')) spawn('open', [local], { stdio: 'ignore', detached: true }).unref();
});

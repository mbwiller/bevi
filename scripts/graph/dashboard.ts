import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createNeo4jClient, neo4jConfigFromEnv } from './neo4j.ts';
import { readSnapshot } from './dashboard-core.ts';

const port = Number(process.env.GRAPH_DASHBOARD_PORT ?? 4317);
const origin = `http://127.0.0.1:${port}`;
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html'], '/app.mjs': ['app.mjs', 'text/javascript'],
  '/metrics.mjs': ['metrics.mjs', 'text/javascript'], '/explore.mjs': ['explore.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
};
let pending: ReturnType<typeof readSnapshot> | undefined;
createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  // Loopback only, strict Host and Origin checks also prevent DNS rebinding.
  if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin)) { response.writeHead(403).end(); return; }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const path = new URL(request.url ?? '/', origin).pathname;
  try {
    if (path === '/api/graph') {
      if (!pending) {
        const client = createNeo4jClient(neo4jConfigFromEnv(process.env), { timeoutMs: 25000 });
        pending = readSnapshot(client).finally(() => { pending = undefined; });
      }
      const snapshot = await pending;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(snapshot)); return;
    }
    const file = files[path];
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': file[1] }).end(await readFile(new URL(`./dashboard/${file[0]}`, import.meta.url)));
  } catch (error) {
    const missing = error instanceof Error && error.message.startsWith('missing NEO4J');
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: missing ? 'Configure NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD and NEO4J_DATABASE in supabase/.env, then restart.' : 'Neo4j is unavailable or the graph query failed. Retry or check the instance status.' }));
  }
}).listen(port, '127.0.0.1', () => console.log(`Bevi graph dashboard: ${origin}`));

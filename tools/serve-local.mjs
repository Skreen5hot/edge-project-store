// Serves the browser pages (browser/*.html) on http://localhost, as the local stand-in for the published page
// (M2-a, M2-d): a second origin besides the page opened as a file, without publishing anything (D10). It listens on
// 127.0.0.1 only, so no other computer can reach it, serves only the browser/ folder's .html files, and reads nothing
// else. Stop it with Ctrl+C.
//
//   node tools/serve-local.mjs [port]        (default 8642)

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'browser');
const port = Number(process.argv[2] ?? 8642);
const pages = new Set(readdirSync(folder).filter((n) => n.endsWith('.html')));

const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1)) || 'eps-project.html';
  if (req.method !== 'GET' || !pages.has(name)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${name}\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(readFileSync(join(folder, name)));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving the EPS browser pages on this computer only (Ctrl+C to stop):`);
  for (const p of [...pages].sort()) console.log(`  http://localhost:${port}/${p}`);
});

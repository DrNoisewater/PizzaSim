// Fake itch.io: the page on one site, the game in an iframe on another site under /html/<upload>/
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const game = () => readFileSync(new URL('../../dist/index.html', import.meta.url));
createServer((req, res) => {
  const up = new URL(req.url, 'http://x').searchParams.get('up') ?? '111';
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><body style="margin:0;background:#222"><iframe id="g" src="http://localhost:8702/html/${up}/index.html" style="width:1000px;height:700px;border:0" allow="autoplay; fullscreen *"></iframe></body>`);
}).listen(8701);
createServer((req, res) => {
  if (/^\/html\/\d+\/index\.html$/.test(req.url)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(game()); }
  else { res.writeHead(404); res.end(); }
}).listen(8702);
console.log('ready');

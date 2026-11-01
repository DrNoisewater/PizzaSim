// Desktop builds run offline, so this downloads the three Google Fonts the game uses
// and embeds them in dist/index.html. If the download fails (no internet), the build
// still succeeds and the game falls back to system fonts when offline.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'dist/index.html');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600;700&family=Lilita+One&display=swap';
// a modern browser user agent makes Google serve woff2
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function main() {
  let html = readFileSync(file, 'utf8');
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Google Fonts returned ' + res.status);
  let css = await res.text();
  // keep only the latin subsets to stay small
  const blocks = css.split('/* ').filter((b) => b.trim()).map((b) => '/* ' + b);
  const latin = blocks.filter((b) => b.startsWith('/* latin */'));
  css = (latin.length ? latin : blocks).join('\n');
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  for (const u of urls) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('font download failed: ' + u);
    const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    css = css.split(u).join('data:font/woff2;base64,' + b64);
  }
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, `<style>${css}</style>`);
  writeFileSync(file, html);
  console.log(`Embedded ${urls.length} font files into dist/index.html`);
}

main().catch((e) => {
  console.warn('Fonts not embedded (' + e.message + '). The game will use system fonts when offline.');
});

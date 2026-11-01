// Inlines the bundled game and stylesheet into single-file pages:
//   dist/index.html     full document (Electron, itch.io, any static host)
//   dist/PizzaSim-<version>.html  same page, named with the version for sharing
//   dist/artifact.html  body-only fragment for publishing as a claude.ai artifact
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'src/styles/game.css'), 'utf8');
const js = readFileSync(join(root, 'dist/game.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
mkdirSync(join(root, 'dist'), { recursive: true });

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://formsubmit.co">`;
const full = tpl.replace('<!--CSP-->', csp).replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
writeFileSync(join(root, 'dist/index.html'), full);

// versioned copy for sharing, e.g. dist/PizzaSim-0.2.1.html (version comes from package.json)
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const meta = readFileSync(join(root, 'src/data/meta.ts'), 'utf8');
if (!meta.includes(`VERSION = '${version}'`)) console.warn(`WARNING: src/data/meta.ts VERSION does not match package.json ${version}`);
for (const f of readdirSync(join(root, 'dist'))) if (/^PizzaSim-.*\.html$/.test(f)) unlinkSync(join(root, 'dist', f));
writeFileSync(join(root, `dist/PizzaSim-${version}.html`), full);
console.log(`dist/PizzaSim-${version}.html`);

// artifact fragment: title, font link, style, markup, script (the host adds the document skeleton)
const head = tpl.slice(tpl.indexOf('<title>'), tpl.indexOf('</head>')).replace(/<link rel="icon"[^>]*>\s*/, '').replace('/*CSS*/', () => css);
const body = tpl.slice(tpl.indexOf('<body>') + 6, tpl.indexOf('</body>')).replace('/*JS*/', () => js);
writeFileSync(join(root, 'dist/artifact.html'), head.trim() + '\n' + body.trim() + '\n');
console.log(`dist/index.html ${(full.length / 1024).toFixed(0)} KB`);

// itch.io upload: a zip with index.html at the top level ("This file will be played in the browser").
// Every HTML game on itch shares one site (html-classic.itch.zone), so saves use IndexedDB plus
// prefixed localStorage keys; see src/platform/storage.ts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
try {
  for (const f of readdirSync(join(root, 'dist'))) if (/^PizzaSim-.*-itch\.zip$/.test(f)) unlinkSync(join(root, 'dist', f));
  const tmp = mkdtempSync(join(tmpdir(), 'pizza-itch-'));
  copyFileSync(join(root, 'dist/index.html'), join(tmp, 'index.html'));
  const zip = join(root, `dist/PizzaSim-${version}-itch.zip`);
  execFileSync('zip', ['-q', '-9', zip, 'index.html'], { cwd: tmp });
  rmSync(tmp, { recursive: true, force: true });
  if (existsSync(zip)) console.log(`dist/PizzaSim-${version}-itch.zip`);
} catch {
  console.warn('itch.io zip skipped (no zip tool found). Zip dist/index.html by hand for itch.io.');
}

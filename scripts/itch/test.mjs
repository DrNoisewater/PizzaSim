// Saves and feedback in an itch.io-like setup: run `node scripts/itch/server.mjs &` then `node scripts/itch/test.mjs`.
// The game loads in a cross-site iframe under /html/<upload id>/ like itch serves it; FormSubmit is mocked.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const OLD = readFileSync(new URL('./save-0.3.21.json', import.meta.url), 'utf8');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
const errs = [];
const page = await ctx.newPage(); page.setDefaultTimeout(120000);
page.on('pageerror', (e) => errs.push(e.message));
const posts = [];
let mode = 'ok';
await ctx.route('https://formsubmit.co/**', async (route) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, accept', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  posts.push({ url: route.request().url(), body: JSON.parse(route.request().postData() || '{}'), origin: route.request().headers()['origin'] });
  if (mode === 'fail') return route.abort();
  const body = mode === 'activate' ? { success: 'false', message: 'This form needs Activation. We\'ve sent you an email containing an \'Activate Form\' button.' } : { success: 'true', message: 'The form was submitted successfully.' };
  return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
});
const frame = async (up) => {
  await page.goto(`http://127.0.0.1:8701/?up=${up}`);
  const f = page.frames().find((x) => x.url().includes('/html/'));
  await f.waitForFunction(() => window.pizza);
  try { await f.waitForSelector('#title .foot-note', { timeout: 20000 }); } catch { console.log('no title yet:', await f.evaluate(() => (document.querySelector('#title')?.outerHTML ?? 'none').slice(0, 300))); }
  await f.waitForTimeout(500);
  return f;
};
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' (' + extra + ')' : ''}`);
const t0 = Date.now();
let f = await frame(111);
console.log('title ready after', Date.now() - t0, 'ms');
const act = (a, d = {}) => f.evaluate(([a, d]) => window.pizza.onAct(a, d), [a, d]);
const st0 = await f.evaluate(async () => ({ foot: document.querySelector('#title .foot-note')?.textContent, healthy: await window.pizzaSaves.healthy(), backs: window.pizzaSaves.backends.map((x) => x.name) }));
check('storage works in a cross-site iframe', st0.healthy && !/isn't keeping/.test(st0.foot ?? ''), JSON.stringify(st0));
await act('new-game'); await act('start-game');
await f.evaluate(() => { window.pizza.s.company = 'Itch Test Pies'; });
await act('plan'); await act('plan-go');
for (let i = 0; i < 6; i++) { await f.evaluate(() => { window.pizza.skip(30); window.pizza.s.choice = null; window.pizza.s.notice = null; }); await f.waitForTimeout(50); }
const mid = await f.evaluate(() => [window.pizza.s.phase, window.pizza.s.minute, window.pizza.s.day]);
// tab hidden: the game autosaves
await f.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await f.waitForTimeout(800);
const where = await f.evaluate(async () => {
  const idb = await new Promise((r) => { const q = indexedDB.open('pizzasim', 1); q.onsuccess = () => { const t = q.result.transaction('saves').objectStore('saves').get('auto'); t.onsuccess = () => r(t.result?.meta ?? null); }; q.onerror = () => r(null); });
  const ls = JSON.parse(localStorage.getItem('pizzasim.save.auto') || 'null')?.meta ?? null;
  return { idb, ls };
});
check('autosave on tab switch went to IndexedDB', where.idb?.company === 'Itch Test Pies');
check('and to the localStorage mirror', where.ls?.company === 'Itch Test Pies');
// a game update on itch: new upload id, new path, same site
f = await frame(222);
const cont = await f.evaluate(() => document.querySelector('[data-act="continue"]')?.textContent ?? '');
check('after an itch update, Continue offers the save', /Itch Test Pies|Continue/.test(cont), cont.trim().slice(0, 60));
await f.evaluate(() => window.pizza.onAct('continue', {}));
await f.waitForTimeout(1500);
const back = await f.evaluate(() => [window.pizza.s?.company, window.pizza.s?.phase, window.pizza.s?.minute, window.pizza.s?.day]);
check('mid-service save loads back', back[0] === 'Itch Test Pies' && back[1] === mid[0] && back[3] === mid[2], JSON.stringify({ saved: mid, loaded: back }));
for (let i = 0; i < 40 && (await f.evaluate(() => window.pizza.s.phase)) !== 'report'; i++) { await f.evaluate(() => { window.pizza.skip(30); window.pizza.s.choice = null; window.pizza.s.notice = null; }); await f.waitForTimeout(40); }
check('loaded game plays to the end of the day', (await f.evaluate(() => window.pizza.s.phase)) === 'report');
// localStorage full (other itch games share the site): saves still work through IndexedDB
const filled = await f.evaluate(() => { let n = 0; const chunk = 'x'.repeat(500000); try { for (; n < 40; n++) localStorage.setItem('other-game-' + n, chunk); } catch {} return n; });
const okFull = await f.evaluate(() => window.pizza.save('1'));
check('saves still work with localStorage full', okFull === true, `filled ${filled} × 500 KB`);
await f.evaluate(() => { for (let n = 0; n < 40; n++) localStorage.removeItem('other-game-' + n); });
// nothing can be written: the player is told once
await f.evaluate(() => { const ps = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new Error('blocked'); }; Storage.prototype._set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('blocked'); }; window.__restore = () => { IDBObjectStore.prototype.put = ps; Storage.prototype.setItem = Storage.prototype._set; }; });
const okBlocked = await f.evaluate(() => window.pizza.save('auto'));
const toast = await f.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '));
check('blocked storage: save reports failure and warns', okBlocked === false && /won't let the game save/.test(toast));
await f.evaluate(() => window.__restore());
// old save from v0.3.21 still loads
await f.evaluate((j) => window.pizza.loadState(JSON.parse(j)), OLD);
await f.waitForTimeout(800);
const old = await f.evaluate(() => [window.pizza.s.day, window.pizza.s.version, window.pizza.s.stores[0].autoSchedule]);
await f.evaluate(() => window.pizza.onAct('plan', {}));
await f.evaluate(() => window.pizza.onAct('plan-go', {}));
for (let i = 0; i < 40 && (await f.evaluate(() => window.pizza.s.phase)) !== 'report'; i++) { await f.evaluate(() => { window.pizza.skip(30); window.pizza.s.choice = null; window.pizza.s.notice = null; }); await f.waitForTimeout(40); }
check('0.3.21 save loads and plays a day', (await f.evaluate(() => window.pizza.s.phase)) === 'report', JSON.stringify(old));
// feedback
const send = async (m, notes) => {
  mode = m;
  await f.evaluate(() => window.pizza.onAct('feedback', {}));
  await f.waitForTimeout(300);
  await f.evaluate((n) => { const t = document.getElementById('fb-notes'); t.value = n; t.dispatchEvent(new Event('input', { bubbles: true })); }, notes);
  await f.evaluate(() => window.pizza.onAct('fb-send', {}));
  await f.waitForFunction(() => !/Sending/.test(document.getElementById('fb-status')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  return f.evaluate(() => [document.getElementById('fb-status')?.textContent, document.getElementById('fb-notes')?.value]);
};
let r = await send('ok', 'Test note: the oven is great.');
const p0 = posts[posts.length - 1];
check('feedback posts to FormSubmit for the right address', p0?.url === 'https://formsubmit.co/ajax/jferguson2194@hotmail.com', p0?.url);
check('feedback has From, Notes, Game, Device, Version', ['From', 'Notes', 'Game', 'Device', 'Version', '_subject'].every((k) => p0?.body?.[k]), Object.keys(p0?.body ?? {}).join(','));
check('sent: notes clear and say thanks', /Thanks/.test(r[0]) && r[1] === '', JSON.stringify(r));
r = await send('activate', 'Second note.');
check('first send from a new site: notes are kept', /Almost there/.test(r[0]) && r[1] === 'Second note.', JSON.stringify(r));
r = await send('fail', 'Third note.');
check('offline: notes are kept and it says so', /Couldn't send/.test(r[0]) && r[1] === 'Third note.', JSON.stringify(r));
console.log('request origin seen by FormSubmit:', posts[0]?.origin);
console.log('page errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
process.exit(0);

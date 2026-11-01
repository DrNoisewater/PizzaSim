// Full-screen and modal views: title, new game, load, day report receipt, events,
// pause menu, settings, help, game over.
import type { GameState, DayReport } from '../core/types';
import { LOC, WEATHER, DAY_NAMES, ROLES, shiftHours } from '../data/world';
import { ingredientPrice } from '../core/economy';
import { ITEM, type ItemId, type IngId } from '../data/catalog';
import { DIFFICULTY } from '../core/state';
import * as P from '../data/portraits';
import { UPDATES } from '../data/changelog';
import { CREW_MSGS, crewMsgPick, type CrewMsgKind } from '../core/manager';
import { CELEBRATIONS, celebrationDue, celebrationCost, type CelebrationId } from '../core/crew';
import { pickSplash } from '../data/splash';
import { STUDIO, VERSION, BUILD_NAME, BUILD_DATE, PIE_SLICES, PIE_SHARES, CRITIC_NAME, CRITIC_PAPER } from '../data/meta';
import { INSPECTOR_NAME, letter } from '../core/inspector';
import { money, plural } from '../core/util';
import type { SaveMeta, Settings } from '../platform/storage';
import { pizzaRating, esc, icon, stars, fullscreenSupported, isFullscreen } from './dom';

export function titleScreen(opts: { latest: SaveMeta | null; hasSaves: boolean; where: string; desktop: boolean }): string {
  const l = opts.latest;
  return `<div class="title-card">
    <p class="studio">${STUDIO} presents</p>
    <div class="logo-wrap"><h1 class="logo">Pizza<small>SIM</small>${splashHtml()}</h1></div>
    <div class="menu-stack">
      ${l ? `<button class="btn red big-cta" data-act="continue">${icon('play', 18)} Continue <span class="num" style="font-family:var(--font-num);font-size:15px;opacity:.9">Day ${l.day} · ${money(l.cash)}</span></button>` : ''}
      <button class="btn ${l ? '' : 'red big-cta'}" data-act="new-game">New pizzeria</button>
      <button class="btn" data-act="load-screen">${opts.hasSaves ? 'Load game' : 'Load a save file'}</button>
      <div class="row" style="gap:8px">
        <button class="btn grow" data-act="help">How to play</button>
        <button class="btn grow" data-act="settings">Settings</button>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn grow" data-act="credits">Credits</button>
        <button class="btn grow" data-act="feedback">Feedback</button>
      </div>
      ${opts.desktop ? '<button class="btn" data-act="quit-app">Exit to desktop</button>' : ''}
    </div>
    <p class="foot-note">${esc(opts.where)} · Drag to slide around, pinch or scroll to zoom, twist or right-drag to turn</p>
    <p class="foot-note version">© 2026 ${STUDIO} · v${VERSION}</p>
  </div>`;
}

export function newGameScreen(name: string, diff: string): string {
  return `<div class="title-card">
    <h1 class="logo" style="font-size:clamp(48px,12vw,72px)">New<small>Pizzeria</small></h1>
    <div class="menu-stack" data-form="new-game">
      <div class="field"><label for="ng-name">Pizzeria name</label><input id="ng-name" type="text" maxlength="22" autocomplete="off" enterkeyhint="go" value="${esc(name)}" /></div>
      <div class="field"><label>Difficulty</label>
        <div class="seg" role="group" style="margin:0">${(Object.keys(DIFFICULTY) as (keyof typeof DIFFICULTY)[]).map((k) => `<button type="button" data-act="ng-diff" data-v="${k}" aria-pressed="${diff === k}">${DIFFICULTY[k].label}</button>`).join('')}</div>
        <div class="t-meta">${esc(DIFFICULTY[diff as keyof typeof DIFFICULTY].desc)} Starting cash ${money(DIFFICULTY[diff as keyof typeof DIFFICULTY].cash)}.</div>
      </div>
      <button class="btn red big-cta" type="button" data-act="start-game">Open the doors</button>
      <button class="btn" type="button" data-act="title">Back</button>
    </div>
  </div>`;
}

export function loadScreen(list: SaveMeta[], fromGame: boolean): string {
  return `<div class="title-card">
    <h1 class="logo" style="font-size:clamp(48px,12vw,72px)">Load<small>Game</small></h1>
    <div class="menu-stack">
      ${list.length ? list.map((m) => `<div class="save-slot"><div class="grow"><div class="t-name">${esc(m.company)} <span class="chip">${m.slot === 'auto' ? 'Autosave' : 'Slot ' + esc(m.slot)}</span></div>
        <div class="t-meta">Day ${m.day} · level ${m.level} · ${money(m.cash)} · ${plural(m.stores, 'store')} · ${new Date(m.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
        <button class="btn buy small" data-act="load" data-slot="${esc(m.slot)}">Load</button>
        <button class="icon-btn" data-act="export-save" data-slot="${esc(m.slot)}" aria-label="Download this save as a file" title="Download as a file">${icon('download', 16)}</button>
        <button class="icon-btn" data-act="delete-save" data-slot="${esc(m.slot)}" aria-label="Delete save">${icon('trash', 16)}</button></div>`).join('') : '<p class="t-meta">No saved games in this browser.</p>'}
      <div class="ticket save-files"><b>Save files</b><div class="t-meta">Tap the download button next to a save to keep a copy as a file, in case browser data gets cleared, or to move it to another device. Load it back here any time.</div>
        <button class="btn block" data-act="import-save" style="margin-top:8px">${icon('upload', 16)} Load a save file</button></div>
      <button class="btn" data-act="${fromGame ? 'pause' : 'title'}">Back</button>
    </div>
  </div>`;
}

/** A one-liner for the top of the receipt, picked from how the day went. */
function receiptQuip(day: number, profit: number, served: number, lost: number, drops: number, soldOut: number, sat: number): string {
  const pick = (xs: string[]) => xs[(day * 7 + served) % xs.length];
  if (served === 0) return pick(['Quiet day. Very quiet. Suspiciously quiet.', 'The oven got a day off. Lucky oven.']);
  if (soldOut >= 5) return pick(['"Sorry, we\'re out of that" said one too many times today.', 'The walk-in looks like it was robbed.']);
  if (drops >= 4) return pick(['The floor ate well tonight.', `${drops} pizzas got a second try today. Practice makes pizza.`, 'Somewhere, a burnt crust is being quietly forgiven.']);
  if (lost >= served * 0.25) return pick(['The line had a line.', 'Somewhere out there, hungry people are still waiting.', 'Busy is good. Too busy is a lot of sad faces.']);
  if (profit > 0 && sat >= 75) return pick(['Happy customers, happy books. Chef\'s kiss.', 'Crust: crispy. Customers: happy. Accountant: smiling.', 'Someone frame this receipt.']);
  if (profit < 0) return pick(['Tomorrow is another pie.', 'Not every dough rises. Regroup and go again.', 'The books are bleeding marinara.']);
  return pick(['Another day, another dough.', 'Ovens off, lights low, floors mopped.', 'Thanks for the slices, everyone.', 'Good shift. Same time tomorrow?']);
}

let splash: ReturnType<typeof pickSplash> | null = null;

/** The splash line stays put for this launch; tapping it rolls a new one. */
export function rerollSplash() {
  splash = pickSplash();
}

export function splashHtml(): string {
  splash ??= pickSplash();
  const n = splash.text.length;
  const long = n > 60 ? ' long xlong' : n > 30 ? ' long' : '';
  return `<button type="button" class="splash tier-${splash.tier}${long}" data-act="splash" title="Tap for another">${esc(splash.text)}</button>`;
}

/** The manager's part of the receipt: what they handled today, and tonight's crew message. */
function managerBlock(s: GameState, r: DayReport): string {
  let h = '';
  for (const x of r.stores) {
    const st = s.stores.find((q) => q.id === x.storeId);
    const m = st?.staff.find((y) => y.role === 'manager' && y.status === 'active');
    if (!st || !m) continue;
    const where = s.stores.length > 1 ? ` · ${esc(LOC[st.locationId].name)}` : '';
    const first = esc(m.name.split(' ')[0]);
    const notes = x.stats.mgrNotes ?? [];
    let body = notes.map((n) => `<div class="note">${icon('staff', 16)}<span>${esc(n)}</span></div>`).join('');
    if (st.crew?.sentDay === s.day) body += `<div class="note">${icon('check', 16)}<span>${esc(st.crew.result ?? 'Message sent.')}</span></div>`;
    else {
      const pick = crewMsgPick(s, st);
      body += `<div class="crew-msg"><div class="t-meta">Message the crew tonight? ${first} suggests <b>${esc(pick ? CREW_MSGS[pick].label : '')}</b>.</div><div class="crew-opts">${(Object.keys(CREW_MSGS) as CrewMsgKind[]).map((k) => `<button class="btn tiny ${k === pick ? 'gold' : ''} ${CREW_MSGS[k].tone === 'neg' ? 'neg-msg' : ''}" data-act="crew-msg" data-v="${k}" data-store="${st.id}">${esc(CREW_MSGS[k].label)}</button>`).join('')}</div></div>`;
    }
    h += `<hr/><div class="center">Manager · ${first}${where}</div>${body}`;
  }
  return h;
}

/** After a good run of days: a little something to thank the crew. */
function celebrateBlock(s: GameState, r: DayReport): string {
  let h = '';
  for (const x of r.stores) {
    const st = s.stores.find((q) => q.id === x.storeId);
    if (!st) continue;
    const due = celebrationDue(s, st);
    const c = st.celebrate;
    if (!due && !(c?.doneDay === s.day && c.result)) continue;
    const where = s.stores.length > 1 ? ` · ${esc(LOC[st.locationId].name)}` : '';
    if (c?.doneDay === s.day) {
      h += `<hr/><div class="center">Crew celebration${where}</div><div class="note">${icon('heart', 16)}<span>${esc(c.result ?? '')}</span></div>`;
      continue;
    }
    h += `<hr/><div class="center">Celebrate the crew${where}</div>
      <div class="note">${icon('star', 16)}<span>Three good days in a row. A small thank-you goes a long way.</span></div>
      <div class="celebrate-opts">${(Object.keys(CELEBRATIONS) as CelebrationId[]).map((k) => {
        const d = CELEBRATIONS[k];
        const cost = celebrationCost(s, st, k);
        return `<button class="btn small cel-opt" data-act="celebrate" data-v="${k}" data-store="${st.id}" ${cost > s.cash ? 'disabled' : ''}><span class="grow"><b>${esc(d.name)}</b><span class="t-meta">${esc(d.desc)}</span></span><span class="num">${cost ? money(cost) : 'Free'}</span></button>`;
      }).join('')}
      <button class="btn tiny block" data-act="celebrate-skip" data-store="${st.id}">Not this time</button></div>`;
  }
  return h;
}

/** Where the food money and the wage money went today, for the receipt's fold-out sections. */
function costBreakdowns(s: GameState, r: DayReport, revenue: number): string {
  const row = (a: string, b: string, cls = '') => `<div class="line sub ${cls}"><span>${a}</span><span class="lead"></span><span>${b}</span></div>`;
  const pct = (v: number) => (revenue > 0 ? `${Math.round((v / revenue) * 100)}%` : '—');
  // food: what the pizzas and sides sold today cost in ingredients
  const items: { id: ItemId; n: number; cost: number }[] = [];
  let used = 0, bought = 0, spoiled = 0;
  for (const x of r.stores) {
    const st = s.stores.find((q) => q.id === x.storeId);
    if (!st) continue;
    bought += x.stats.supplies;
    spoiled += x.stats.waste;
    for (const [k, n] of Object.entries(x.stats.sold) as [ItemId, number][]) {
      const each = Object.entries(ITEM[k].recipe ?? {}).reduce((a, [ing, q]) => a + ingredientPrice(s, st, ing as IngId) * (q ?? 0), 0);
      const hit = items.find((i) => i.id === k);
      if (hit) { hit.n += n; hit.cost += each * n; } else items.push({ id: k, n, cost: each * n });
      used += each * n;
    }
  }
  items.sort((a, b) => b.cost - a.cost);
  // the sim's own count includes remakes and boxes; fall back to the recipe estimate for old saves
  const real = r.stores.reduce((a, x) => a + (x.stats.foodCost ?? 0), 0);
  if (real > 0) used = real;
  const foodPct = revenue > 0 ? used / revenue : 0;
  const food = `<details class="r-fold"><summary><span>Food cost</span><span class="${foodPct > 0.36 ? 'neg' : foodPct && foodPct <= 0.3 ? 'pos' : ''}">${money(used)} · ${pct(used)} of sales</span></summary>
    ${items.slice(0, 5).map((i) => row(`${esc(ITEM[i.id].name)} ×${i.n}`, `${money(i.cost)} <span class="t-meta">(${money(i.cost / Math.max(1, i.n), true)} each)</span>`)).join('')}
    ${row('Stock bought today', money(bought))}
    ${spoiled > 1 ? row('Spoiled (thrown out)', money(spoiled), 'neg') : ''}
    <div class="r-hint">Ingredients in what you sold. Aim for 25–32% of sales: raise prices on the costly ones, or push the cheaper pizzas with a special.</div>
  </details>`;
  // labor: wages by role from today's shifts
  const roles = new Map<string, { n: number; h: number; pay: number }>();
  let callIn = 0, ot = 0, roadSaved = 0, mileage = 0, tips = 0;
  for (const x of r.stores) {
    callIn += x.stats.callInWages ?? 0;
    ot += x.stats.overtime ?? 0;
    roadSaved += x.stats.roadSaved ?? 0;
    mileage += x.stats.mileage ?? 0;
    tips += x.stats.tips ?? 0;
    const st = s.stores.find((q) => q.id === x.storeId);
    for (const y of st?.staff ?? []) {
      if (y.status !== 'active' || y.offToday) continue;
      const h = shiftHours(y.shift);
      const g = roles.get(y.role) ?? { n: 0, h: 0, pay: 0 };
      // drivers' road time is paid at the lower road rate
      g.n++; g.h += h; g.pay += h * y.wage;
      roles.set(y.role, g);
    }
  }
  const wages = r.stores.reduce((a, x) => a + x.stats.wages, 0);
  const laborPct = revenue > 0 ? wages / revenue : 0;
  const order = ['manager', 'cook', 'front', 'driver'] as const;
  const labor = `<details class="r-fold"><summary><span>Labor</span><span class="${laborPct > 0.35 ? 'neg' : laborPct && laborPct <= 0.3 ? 'pos' : ''}">${money(wages)} · ${pct(wages)} of sales</span></summary>
    ${order.filter((k) => roles.has(k)).map((k) => { const g = roles.get(k)!; return row(`${ROLES[k].plural} · ${g.n} on, ${g.h} h`, money(g.pay)); }).join('')}
    ${callIn ? row('Called in for the rush', money(callIn)) : ''}
    ${ot > 0.5 ? row('Overtime (time and a half past 40 hrs)', money(ot), 'neg') : ''}
    ${roadSaved > 0.5 ? row('Drivers on the road ($7/hr rate)', '−' + money(roadSaved), 'pos') : ''}
    ${mileage > 0 ? row('Driver mileage (in other costs)', money(mileage)) : ''}
    ${tips > 0 ? row('Driver tips (paid by customers)', money(tips), 'pos') : ''}
    ${r.stores.reduce((a, x) => a + x.stats.served, 0) ? row('Labor per customer', money(wages / r.stores.reduce((a, x) => a + x.stats.served, 0), true)) : ''}
    <div class="r-hint">Aim for 25–30% of sales. Suggest a schedule trims hours the forecast doesn't need; slow days are where it adds up.</div>
  </details>`;
  return `<div class="r-folds">${food}${labor}</div>`;
}

export function reportModal(s: GameState, r: DayReport): string {
  const sum = (k: 'revenue' | 'supplies' | 'wages' | 'rent' | 'marketing' | 'other' | 'loan' | 'equipment' | 'served' | 'lost' | 'deliveries' | 'refunds' | 'waste' | 'soldOut' | 'turnedAway' | 'walkouts' | 'drops') => r.stores.reduce((a, x) => a + (x.stats[k] ?? 0), 0);
  const sat = r.stores.reduce((a, x) => a + x.stats.satSum, 0) / Math.max(1, r.stores.reduce((a, x) => a + x.stats.satCount, 0));
  const costs = sum('supplies') + sum('wages') + sum('rent') + sum('marketing') + sum('other') + sum('loan');
  const profit = sum('revenue') - costs;
  const sold: Partial<Record<ItemId, number>> = {};
  for (const x of r.stores) for (const [k, v] of Object.entries(x.stats.sold)) sold[k as ItemId] = (sold[k as ItemId] ?? 0) + (v ?? 0);
  const top = (Object.entries(sold) as [ItemId, number][]).filter(([k]) => ITEM[k].type === 'pizza').sort((a, b) => b[1] - a[1])[0];
  const line = (label: string, v: string, cls = '') => `<div class="line ${cls}"><span>${label}</span><span class="lead"></span><span>${v}</span></div>`;
  const dow = DAY_NAMES[(r.day - 1) % 7];
  return `<div class="receipt-wrap" role="dialog" aria-label="End of day report">
    <div class="receipt">
      <h2>${esc(s.company)}</h2>
      <div class="center">Day ${r.day} · ${dow} · closing receipt</div>
      <div class="center receipt-quip">${esc(receiptQuip(r.day, profit, sum('served'), sum('walkouts') + sum('turnedAway'), sum('drops'), sum('soldOut'), sat))}</div>
      <hr/>
      ${line('Sales', money(sum('revenue'), true))}
      ${line('Supplies', '−' + money(sum('supplies'), true), 'sub')}
      ${line('Wages', '−' + money(sum('wages'), true), 'sub')}
      ${r.stores.some((x) => x.stats.callInWages) ? line('&nbsp;&nbsp;incl. called-in hours', money(r.stores.reduce((a, x) => a + (x.stats.callInWages ?? 0), 0), true), 'sub') : ''}
      ${line('Rent', '−' + money(sum('rent'), true), 'sub')}
      ${sum('marketing') ? line('Marketing', '−' + money(sum('marketing'), true), 'sub') : ''}
      ${sum('other') ? line('Other (mileage, training, bonuses)', '−' + money(sum('other'), true), 'sub') : ''}
      ${sum('loan') ? line('Loan payment', '−' + money(sum('loan'), true), 'sub') : ''}
      <hr/>
      ${line('Profit', (profit < 0 ? '−' : '') + money(Math.abs(profit), true), 'total ' + (profit < 0 ? 'neg' : 'pos'))}
      ${sum('equipment') ? line('Invested in equipment', money(sum('equipment')), 'sub') : ''}
      ${line('Cash on hand', money(r.cashEnd), 'sub')}
      ${costBreakdowns(s, r, sum('revenue'))}
      <hr/>
      ${line('Customers served', String(sum('served')))}
      ${sum('turnedAway') ? line('Saw the line and kept walking', String(sum('turnedAway')), 'sub') : ''}
      ${sum('walkouts') ? line('Gave up waiting', String(sum('walkouts')), 'sub neg') : ''}
      ${sum('soldOut') ? line('Left: sold out', String(sum('soldOut')), 'sub neg') : ''}
      ${sum('refunds') ? line('Refunds', String(sum('refunds')), 'sub neg') : ''}
      ${sum('drops') ? line('Pizzas remade', String(sum('drops')), 'sub') : ''}
      ${sum('deliveries') ? line('Deliveries', String(sum('deliveries')), 'sub') : ''}
      ${line('Avg. satisfaction', sat ? Math.round(sat) + '%' : '—', 'sub')}
      ${top ? line('Best seller', `${esc(ITEM[top[0]].name)} ×${top[1]}`, 'sub') : ''}
      ${sum('waste') > 1 ? line('Spoiled stock', money(sum('waste')), 'sub neg') : ''}
      ${r.stores.map((x) => {
        const st = s.stores.find((q) => q.id === x.storeId);
        if (!st) return '';
        const d = st.rating - x.ratingStart;
        return line(`${esc(LOC[st.locationId].name)} rating`, `<span class="r-inline">${pizzaRating(st.rating, 22, false)}</span> ${st.rating.toFixed(2)} <span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(2)}</span>`, 'sub');
      }).join('')}
      ${s.level > r.levelStart ? `<hr/><div class="note">${icon('star', 16)}<span><b>Level up!</b> You reached level ${s.level}.</span></div>` : ''}
      ${r.advice?.length ? '<hr/><div class="center">Tip</div>' + r.advice.map((n) => `<div class="note">${icon('bolt', 16)}<span>${esc(n)}</span></div>`).join('') : ''}
      ${s.stores.filter((st) => st.fameNew === r.day).map((st) => { const f = (st.fame ?? [])[(st.fame ?? []).length - 1]; return f ? `<hr/><div class="note fame-note">${icon('star', 16)}<span><b>You got noticed!</b> ${esc(f.outlet)}: ${esc(f.headline)}. Expect a rush, and a bit more foot traffic for good. See Goals → Wall of Fame.</span></div>` : ''; }).join('')}
      ${managerBlock(s, r)}
      ${celebrateBlock(s, r)}
      ${r.notes.length ? '<hr/>' + r.notes.map((n) => `<div class="note">${icon('info', 16)}<span>${esc(n)}</span></div>`).join('') : ''}
      <hr/>
      <div class="center">Tomorrow</div>
      ${r.tomorrow.map((n) => `<div class="note">${icon(n.startsWith('Forecast') ? s.forecast : n.includes('shortage') ? 'alert' : 'clock', 16)}<span>${esc(n)}</span></div>`).join('')}
    </div>
    <div class="receipt-foot">
      ${s.gameOver ? '<button class="btn red block big-cta" data-act="game-over">See what happened</button>' : `<button class="btn red block big-cta" data-act="plan">Plan and open day ${r.day + 1}</button><button class="btn tiny block" data-act="next-day" style="margin-top:6px">Start day ${r.day + 1} in morning prep</button>`}
    </div>
  </div>`;
}

/** Inspector Logan's and the critic's arrival and verdict pop-ups. */
export function noticeModal(s: GameState): string {
  const n = s.notice!;
  const grade = (label: string, v: number) => `<div class="grade-card g-${letter(v)}"><span class="grade-l">${letter(v)}</span><span class="grade-t">${label}<b class="num">${v}/100</b></span></div>`;
  const critic = n.kind === 'criticArrive' || n.kind === 'criticReport';
  const src = n.kind === 'loganArrive' ? P.LOGAN_ARRIVE : n.kind === 'loganReport' ? (n.pass ? P.LOGAN_PASS : P.LOGAN_FAIL) : n.kind === 'criticArrive' || n.tier === 'meh' ? P.CRITIC_ARRIVE : n.pass ? P.CRITIC_PASS : P.CRITIC_FAIL;
  const who = critic ? CRITIC_NAME : INSPECTOR_NAME;
  const photo = `<img class="visitor-photo ${critic ? 'critic' : ''}" src="${src}" alt="${esc(who)}" width="120" height="180">`;
  const role = critic ? `Food critic · ${CRITIC_PAPER}` : 'Health & operations inspector';
  if (n.kind === 'loganArrive' || n.kind === 'criticArrive') {
    return `<div class="modal notice" role="dialog" aria-label="${esc(n.title)}">
      <div class="visitor">${photo}<div class="grow"><div class="hud-label" style="color:var(--ink-soft)">${role}</div><h2 style="margin:2px 0 6px">${esc(n.title)}</h2><p style="margin:0">${esc(n.body)}</p></div></div>
      <p class="t-meta">${critic ? 'Watch for him in the dining room. Fast, fresh, hot food and a clean room are what he cares about.' : 'Watch for him walking the store with his clipboard. Keep the line moving and the tables clean.'}</p>
      <div class="btns"><button class="btn red block" data-act="notice-ok">${critic ? 'Fire up the oven' : 'Look sharp, everyone'}</button></div>
    </div>`;
  }
  if (n.kind === 'criticReport') {
    const bar = ([l, v]: [string, number]) => `<div class="score-row"><span>${esc(l)}</span>${meterBar(v)}<b class="num">${v}</b></div>`;
    return `<div class="modal notice" role="dialog" aria-label="${esc(n.title)}">
      <div class="visitor">${photo}<div class="grow"><div class="hud-label" style="color:var(--ink-soft)">${role}</div><h2 style="margin:2px 0 4px">${esc(n.title)}</h2>
        <blockquote class="critic-quote">“${esc(n.body)}”</blockquote>
        <div class="t-meta">Overall <b class="num" style="font-size:18px;color:var(--ink)">${n.score}</b>/100</div></div></div>
      ${n.scores?.length ? `<div class="ticket">${n.scores.map(bar).join('')}</div>` : ''}
      ${n.tips?.length ? `<div class="ticket">${n.tips.map((t) => `<div class="note-row">${icon('info', 15)}<span>${esc(t)}</span></div>`).join('')}</div>` : ''}
      <p class="${n.pass ? 'pos' : n.tier === 'meh' ? '' : 'neg'}" style="font-weight:700">${esc(n.effect ?? '')}</p>
      <div class="btns"><button class="btn red block" data-act="notice-ok">${n.pass ? 'Frame that review' : 'Noted'}</button></div>
    </div>`;
  }
  return `<div class="modal notice" role="dialog" aria-label="${esc(n.title)}">
    <div class="visitor">${photo}<div class="grow"><div class="hud-label" style="color:var(--ink-soft)">${esc(n.body)}</div><h2 style="margin:2px 0 4px">${esc(n.title)}</h2>
      <span class="chip ${n.pass ? 'good' : 'bad'}">${esc(n.tier ?? '')}</span>
      <div class="t-meta" style="margin-top:6px">Overall score <b class="num" style="font-size:18px;color:var(--ink)">${n.score}</b>/100</div>
      <div class="grades">${grade('Health', n.health ?? 0)}${grade('Operations', n.ops ?? 0)}</div></div></div>
    <div class="section-label">Logan's pointers</div>
    <div class="ticket">${(n.tips ?? []).map((t) => `<div class="note-row">${icon('info', 15)}<span>${esc(t)}</span></div>`).join('')}</div>
    <p class="${n.pass ? 'pos' : 'neg'}" style="font-weight:700">${esc(n.effect ?? '')}</p>
    <div class="btns"><button class="btn red block" data-act="notice-ok">Thanks, Logan</button></div>
  </div>`;
}

function meterBar(v: number) {
  return `<span class="meter m-${v >= 75 ? 'good' : v >= 55 ? 'warn' : 'bad'}" style="flex:1"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></span>`;
}

export function choiceModal(s: GameState): string {
  const c = s.choice!;
  return `<div class="modal" role="dialog" aria-label="${esc(c.title)}">
    <h2>${esc(c.title)}</h2>
    <p>${esc(c.body)}</p>
    ${c.options.map((o) => `<button class="choice" data-act="choose" data-id="${esc(o.id)}"><b>${esc(o.label)}</b><span>${esc(o.detail)}</span></button>`).join('')}
  </div>`;
}

export function pauseModal(where: string, desktop: boolean): string {
  return `<div class="modal" role="dialog" aria-label="Paused">
    <h2>Paused</h2>
    <p class="t-meta">${esc(where)}. Pizza SIM v${VERSION} · ${STUDIO}</p>
    <div class="menu-stack" style="box-shadow:none;padding:0;border:0;background:none">
      <button class="btn red" data-act="resume">${icon('play', 16)} Resume</button>
      <div class="section-label" style="margin:10px 2px 0">Save to slot</div>
      <div class="row" style="gap:6px">${['1', '2', '3'].map((n) => `<button class="btn grow" data-act="save" data-slot="${n}">${icon('save', 16)} Slot ${n}</button>`).join('')}</div>
      <button class="btn" data-act="load-screen-game">Load game</button>
      <button class="btn" data-act="export-current">${icon('download', 16)} Download save file</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="help">How to play</button>
      <button class="btn" data-act="credits">Credits</button>
      <button class="btn" data-act="feedback">${icon('info', 16)} Playtest notes &amp; feedback</button>
      ${desktop || fullscreenSupported() ? `<button class="btn" data-act="fullscreen">${icon('expand', 16)} ${isFullscreen() ? 'Exit full screen' : 'Full screen'}${desktop ? ' (F11)' : ''}</button>` : ''}
      <button class="btn" data-act="quit-title">Save and quit to title</button>
      ${desktop ? '<button class="btn" data-act="quit-app">Save and exit to desktop</button>' : ''}
    </div>
  </div>`;
}

export function settingsModal(st: Settings, back: string): string {
  const tog = (key: keyof Settings, label: string, desc: string) => `<div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">${label}</div><div class="t-meta">${desc}</div></div>
    <button class="toggle" data-act="set" data-key="${key}" aria-pressed="${!!st[key]}" aria-label="${label}"></button></div></div>`;
  return `<div class="modal" role="dialog" aria-label="Settings">
    <h2>Settings</h2>
    ${tog('sound', 'Sound effects', 'Cash register dings, oven bells, level-ups.')}
    ${tog('music', 'Music', 'Six original tracks. Calm ones rotate; when the shop gets slammed it switches to rush music, then eases back down as you catch up.')}
    <div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">Volume</div></div>
      <div class="stepper"><button data-act="volume" data-d="-0.1" aria-label="Quieter">${icon('minus', 14)}</button><span class="val">${Math.round(st.volume * 100)}%</span><button data-act="volume" data-d="0.1" aria-label="Louder">${icon('plus', 14)}</button></div></div></div>
    ${tog('shadows', 'Shadows', 'Turn off for smoother play on older devices.')}
    <div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">Graphics quality</div><div class="t-meta">High adds glow, bloom and sharper shadows. Low is smoother on older devices.</div></div>
      <div class="seg" style="margin:0"><button data-act="quality" data-v="high" aria-pressed="${st.quality === 'high'}">High</button><button data-act="quality" data-v="low" aria-pressed="${st.quality === 'low'}">Low</button></div></div></div>
    ${tog('floatingText', 'Floating money', 'Show +$ amounts above customers when they pay.')}
    ${tog('autoNextDay', 'Open automatically', 'Skip the morning prep and open the doors as soon as a day starts.')}
    ${fullscreenSupported() ? tog('fullscreen', 'Full screen', 'Play full screen (starts on your first tap). Turn off to play in a window.') : ''}
    ${tog('camButtons', 'Camera buttons', 'Show zoom and turn buttons on screen. Tap the camera icon to show or hide them any time.')}
    ${tog('dragRotate', 'Classic camera', 'Drag to spin the camera instead of sliding around. Pinch or scroll zooms either way.')}
    <div class="btns"><button class="btn red block" data-act="${back}">Done</button></div>
  </div>`;
}

export function helpModal(back: string): string {
  return `<div class="modal help" role="dialog" aria-label="How to play">
    <h2>How to play</h2>
    <p>You run a pizzeria from one small shop to a chain. Each day has a <b>morning prep</b> (the clock is stopped, so plan), then the store is <b>open 10 AM to 10 PM</b>, then you get the day's receipt. The game pauses itself whenever nothing is happening.</p>
    <h3>The loop</h3>
    <ul>
      <li><b>Customers</b> walk in, line up, order at a till, then sit down or wait for takeout. If the line or the quoted wait is too long they leave; if food takes far longer than promised they want a refund.</li>
      <li><b>Front of house</b> takes orders, runs food to tables, clears dirty tables and mops. <b>Kitchen crew</b> build pizzas, one per make-line station; the <b>oven</b> bakes a few at a time. <b>Drivers</b> deliver once you own a vehicle: they earn the in-store rate inside and a lower road rate while driving, and tips and mileage make up the rest. A <b>manager</b> helps everywhere; hire two or three so every shift has one.</li>
      <li><b>Pay:</b> insiders make about $13–15 an hour, kitchen crew $13–18 (more as they train), managers about $19–23. Hours past 40 in a week are paid time and a half, so Suggest a schedule keeps people at 40 when it can.</li>
      <li>Everyone walks, so layout and staffing both matter. The floor card shows each stage of service; the red one is your bottleneck.</li>
      <li><b>Schedule:</b> Staff → Schedule plans the week. Shifts are Opener (10–6) and Closer (2–close), the 8-hour full-time days, plus OP-CL (open to close, 12 hours), Morning (10–4), Lunch Rush (11–3), Dinner (4–close), Dinner Rush (5–9) and X (off). Today and tomorrow are locked in, so plan two or more days ahead. Each day shows whether lunch and dinner are covered and what labor costs, and each name shows their hours for the week (40 is full time). Suggest a schedule covers the forecast for you; Auto-schedule does it every night.</li>
      <li><b>Managers</b> run the shift instead of the till. They speed up the whole crew, phone around when someone calls in sick, add people to tomorrow when a big night is coming and only jump on the line in a real crunch. When it gets hectic, <b>Message the crew</b> on the floor card texts people who are off to come in for the rush. At night they suggest a <b>crew message</b>: deserved praise lifts morale every night, and a fair call-out barely stings while people try harder.</li>
      <li><b>Stock</b> is used up every day and fresh stuff spoils. Each morning the <b>truck</b> brings the forecast plus your order buffer (Stock → Order buffer). Express deliveries take 90 minutes and cost a lot more. You'll get a warning before anything runs out.</li>
      <li><b>Prices:</b> customers judge against what feels fair today (neighborhood, ingredients, rating, weather, crowds). Specials can run at lunch, dinner or all day.</li>
      <li><b>Buzz and the Wall of Fame:</b> great days, happy customers, good inspections and how you handle surprise visitors build Buzz. At each milestone a newsletter, blog, radio show, magazine or TV show features you: a few busy days and a little more foot traffic for good (Goals → Wall of Fame). Every week or so someone memorable walks in during service; pick how to handle it.</li>
      <li><b>Celebrate the crew:</b> after three good days in a row, the receipt offers a thank-you, from free shout-outs to go-kart racing. Small cost, big morale.</li>
      <li><b>Rating</b> drives traffic. It moves with quality, speed, prices, cleanliness and decor. People who never got in don't leave reviews.</li>
    </ul>
    <h3>Growing</h3>
    <ul>
      <li>Happy customers earn XP. Levels unlock recipes, equipment, campaigns and new locations.</li>
      <li>Open the day plan (prep card or Finance → Service) to see expected customers per hour against what you can serve.</li>
      <li>Staff learn on the job. Evening classes cost money but no time off: one skill level higher the next morning. Skilled staff expect higher wages.</li>
      <li>Watch morale: each staff card says why it moved. Below 20 for two nights and they quit; you get a warning first.</li>
      <li>Supply shortages are announced two days ahead. The calendar and Stock show the last day to buy at the normal price (the day before it starts), and how many days are left once it's on.</li>
      <li>Every so often ${INSPECTOR_NAME}, the health & operations inspector, drops in unannounced and grades you. Rarer still, the food critic ${CRITIC_NAME} comes to dinner.</li>
      <li>Three days with negative cash and the bank closes you down.</li>
    </ul>
    <h3>Controls</h3>
    <ul>
      <li>Drag to slide around the shop, pinch or scroll to zoom, twist two fingers (or right-drag) to turn. The camera icon on the right shows zoom and turn buttons. Tap the oven, register, fridge or staff to jump to their panel. Tap the day in the top bar for the calendar.</li>
      <li><kbd>Space</kbd> or <kbd>P</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> game speed · <kbd>Enter</kbd> open for business · <kbd>Esc</kbd> close / menu</li>
      <li><kbd>S</kbd> staff · <kbd>I</kbd> stock · <kbd>M</kbd> menu · <kbd>U</kbd> upgrades · <kbd>K</kbd> marketing · <kbd>F</kbd> finance · <kbd>E</kbd> empire · <kbd>G</kbd> goals</li>
    </ul>
    <div class="btns"><button class="btn red block" data-act="${back}">Got it</button></div>
  </div>`;
}

/**
 * The credits pie: one pizza shared out by contribution, by percentage. Each icon fills only its
 * owner's share, in its real position, like a round progress bar; the rest of the pie is a faint
 * outline, so the studio's pizza has gaps exactly where the playtesters' shares sit.
 * Shares are handed out counterclockwise from 12 o'clock in credits order: the first
 * playtester gets the top slice to the left of 12, the next one the slice after that, and so
 * on. The studio keeps whatever is left.
 */
type Part = [number, number]; // start and end, clockwise from 12 o'clock, as fractions of the whole pie (0..1)
function pieShares() {
  const people = PIE_SHARES.map((p) => ({ ...p, percent: Math.max(0, Math.min(100, p.percent)) }));
  const given = Math.min(100, people.reduce((a, p) => a + p.percent, 0));
  let at = 0; // counterclockwise distance from 12 o'clock
  const take = (pct: number): Part => {
    const a = at;
    at = Math.min(1, at + pct / 100);
    return [1 - at, 1 - a]; // flip to the clockwise fractions the drawing uses
  };
  const shared = people.map((p) => ({ ...p, part: take(p.percent) }));
  return { studio: { name: STUDIO, part: take(100 - given) }, people: shared };
}

/** Split a part at the pizza's cut lines so each piece is drawn as its own (possibly partial) slice. */
function pieces([a, b]: Part): Part[] {
  const out: Part[] = [];
  const N = PIE_SLICES;
  let x = a;
  while (x < b - 1e-6) {
    const next = Math.min(b, (Math.floor(x * N + 1e-6) + 1) / N);
    out.push([x, next]);
    x = next;
  }
  return out;
}

function pieIcon(part: Part, size: number, label: string): string {
  const R = 46, C = 50, N = PIE_SLICES;
  const ang = (f: number) => f * Math.PI * 2;
  const pt = (f: number, r: number) => `${(C + r * Math.sin(ang(f))).toFixed(2)} ${(C - r * Math.cos(ang(f))).toFixed(2)}`;
  const wedge = ([a, b]: Part, r: number) => `M${C} ${C}L${pt(a, r)}A${r} ${r} 0 ${b - a > 0.5 ? 1 : 0} 1 ${pt(b, r)}Z`;
  // pepperoni at the same spots in every slice so all icons match; only those on this share are drawn
  const pep = ([a, b]: Part) => {
    const out: string[] = [];
    for (let i = Math.floor(a * N + 1e-6); i < b * N; i++)
      for (const [f, r] of [[0.3, 26], [0.5, 34], [0.7, 18]]) {
        const s = (i + f) / N;
        if (s <= a + 0.008 || s >= b - 0.008) continue;
        out.push(`<circle cx="${(C + r * Math.sin(ang(s))).toFixed(2)}" cy="${(C - r * Math.cos(ang(s))).toFixed(2)}" r="4.2" fill="#b8321f"/>`);
      }
    return out.join('');
  };
  const [a, b] = part;
  const ghost = [...pieces([0, a]), ...pieces([b, 1])].map((g) => `<path d="${wedge(g, R - 1)}" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.6" stroke-dasharray="3 3"/>`).join('');
  const mine = pieces(part).map((g) => `<g><path d="${wedge(g, R)}" fill="#d9822b"/><path d="${wedge(g, R - 6)}" fill="#f4c542"/>${pep(g)}<path d="${wedge(g, R)}" fill="none" stroke="#7a3b12" stroke-width="1.4" stroke-linejoin="round"/></g>`).join('');
  return `<svg class="pie-icon" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(label)}">${ghost}${mine}</svg>`;
}

export function feedbackModal(d: { name: string; notes: string; sentAt?: number; sentCount?: number }, back: string): string {
  return `<div class="modal feedback" role="dialog" aria-label="Feedback" style="width:min(560px,100%)">
    <h2>Playtest notes</h2>
    <p class="t-meta">Jot things down while you play: bugs, ideas, what felt off. Notes are saved on this device, even if you close the game. When you're ready, tap Send and they go straight to ${STUDIO}. No email needed.</p>
    <label class="t-meta" for="fb-name">Your name (optional)</label>
    <input id="fb-name" class="text-in" type="text" maxlength="40" value="${esc(d.name)}" placeholder="So we know who to thank">
    <div class="row" style="justify-content:space-between;margin:10px 0 4px"><label class="t-meta" for="fb-notes">Notes</label><span class="row" style="gap:6px"><button class="btn tiny" data-act="fb-bullet" title="Start a bullet point">• Bullet</button><button class="btn tiny" data-act="fb-stamp" title="Add the current day and time">+ Day stamp</button></span></div>
    <textarea id="fb-notes" class="text-in notes" rows="10" placeholder="• The oven got backed up on Friday dinner&#10;• Couldn't find where to order stock">${esc(d.notes)}</textarea>
    <div class="row" style="justify-content:space-between;margin-top:6px"><span id="fb-status" class="t-meta">${d.sentAt ? `Last sent ${new Date(d.sentAt).toLocaleString()}.` : 'Saved automatically.'}</span><span class="t-meta" id="fb-count"></span></div>
    <div class="btns">
      <button class="btn red" data-act="fb-send">${icon('check', 16)} Send to ${STUDIO}</button>
      <button class="btn" data-act="${back}">Close</button>
    </div>
  </div>`;
}

export function updatesModal(open: string, back: string): string {
  const first = open === '' ? UPDATES[0].version : open;
  return `<div class="modal updates" role="dialog" aria-label="What's new" style="width:min(600px,100%)">
    <p class="studio dark">${STUDIO}</p>
    <h2>What's new</h2>
    <p class="t-meta">Every update, newest first. Tap one to open it.</p>
    ${UPDATES.map((u) => {
      const on = u.version === first;
      return `<div class="upd ${on ? 'open' : ''}">
        <button class="upd-head" data-act="upd-open" data-v="${u.version}" aria-expanded="${on}"><span class="upd-v num">v${u.version}</span><span class="grow"><b>${esc(u.title)}</b><span class="t-meta"> · ${esc(u.date)}</span></span><span class="chev">${on ? '▴' : '▾'}</span></button>
        ${on ? `<div class="upd-body">${u.sections.length > 2 ? u.sections.map(([h, items], i) => `<details class="upd-sec"${i === 0 ? ' open' : ''}><summary><span>${esc(h)}</span><span class="t-meta num">${items.length}</span></summary><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('') : u.sections.map(([h, items]) => `<div class="section-label">${esc(h)}</div><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}
    <div class="btns"><button class="btn red block" data-act="${back}">Back</button></div>
  </div>`;
}

export function creditsModal(back: string): string {
  const pie = pieShares();
  const row = (name: string, part: Part, note: string, size: number, big = false) =>
    `<div class="credit-row${big ? ' big' : ''}">${pieIcon(part, size, `${name}'s share of the pie`)}<div class="grow"><b>${esc(name)}</b>${note ? `<div class="t-meta">${note}</div>` : ''}</div></div>`;
  return `<div class="modal credits" role="dialog" aria-label="Credits">
    <p class="studio dark">${STUDIO}</p>
    <h2>Pizza SIM</h2>
    <button class="link-btn" data-act="updates" title="What's new">Version ${VERSION} · “${BUILD_NAME}” · ${BUILD_DATE} <span class="more-link">What's new?</span></button>
    <div class="section-label">Made by</div>
    <div class="ticket">${row(pie.studio.name, pie.studio.part, 'Design, code, art and pizza.', 52, true)}</div>
    <div class="section-label">Playtesters</div>
    <div class="ticket">${pie.people.filter((p) => p.role === 'playtester').map((p) => row(p.name, p.part, p.note ? esc(p.note) : '', 40)).join('')}</div>
    <p class="t-meta">Thanks to everyone who dropped a pizza, waited in a too-long line, and told us about it.</p>
    <p class="t-meta">© 2026 ${STUDIO}. All rights reserved.</p>
    <div class="btns"><button class="btn red block" data-act="${back}">Close</button></div>
  </div>`;
}

export function gameOverModal(s: GameState): string {
  return `<div class="modal" role="dialog" aria-label="Game over">
    <h2>The bank closed you down</h2>
    <p>${esc(s.company)} ran out of money after ${plural(s.stats.daysCompleted, 'day')} in business.</p>
    <div class="ticket"><dl class="kv"><dt>Customers served</dt><dd>${s.stats.served.toLocaleString()}</dd><dt>Lifetime sales</dt><dd>${money(s.stats.revenue)}</dd><dt>Stores</dt><dd>${s.stores.length}</dd><dt>Level reached</dt><dd>${s.level}</dd></dl></div>
    <p class="t-meta">Tip: keep a cash cushion for wages and rent, and don't buy equipment you can't staff yet.</p>
    <div class="btns"><button class="btn red" data-act="new-game">Start a new pizzeria</button><button class="btn" data-act="load-screen-game">Load a save</button></div>
  </div>`;
}

export function weatherLabel(s: GameState) {
  return WEATHER[s.weather].name;
}

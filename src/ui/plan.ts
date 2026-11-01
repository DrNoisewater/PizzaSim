// Today's / Tomorrow's plan: the quick way to play. One screen answers "am I ready?" (customers,
// stock, staff, promo) and one button orders the truck and opens the doors.
import type { GameState, Store } from '../core/types';
import { daySummary, LIMIT_LABEL, LIMIT_FIX, withSchedule, staffingGaps, planDay, type HourRow } from '../core/forecast';
import { suggestOrder, truckLines } from '../core/inventory';
import { ingredientPrice } from '../core/economy';
import { shortages, shortageChip } from '../core/shortage';
import { loc } from '../core/state';
import { money, clock, plural } from '../core/util';
import { ING, type IngId } from '../data/catalog';
import { CAMPAIGNS, DAY_NAMES, OPEN_MIN, ROLES, SHIFTS, WEATHER } from '../data/world';
import { esc, icon } from './dom';

type Tone = 'good' | 'warn' | 'bad';
interface Check { key: string; tone: Tone; icon: string; title: string; body: string; act?: { label: string; act: string; extra?: string } }

const toneIcon: Record<Tone, string> = { good: 'check', warn: 'info', bad: 'alert' };

/** People on in each opening hour, by role, for whatever shifts are applied right now. */
function crewByHour(st: Store) {
  const out = { cook: new Array(12).fill(0), front: new Array(12).fill(0), driver: new Array(12).fill(0) } as Record<'cook' | 'front' | 'driver', number[]>;
  for (const x of st.staff) {
    if (x.status !== 'active' || x.offToday || x.role === 'manager') continue;
    for (let h = 0; h < 12; h++) {
      const m = OPEN_MIN + h * 60 + 30;
      if (m >= SHIFTS[x.shift].start && m < SHIFTS[x.shift].end) out[x.role][h]++;
    }
  }
  return out;
}

/**
 * Hour-by-hour chart: each bar is the customers expected, green for the ones you can serve and
 * red for the ones you'd lose. Capacity is one continuous step line. Under it, who's on.
 */
export function planChart(rows: HourRow[], crew: ReturnType<typeof crewByHour>, delivery: boolean): string {
  const W = 420, L = 30, R = 6, T = 10, CH = 130, rowH = 15;
  const crewRows: [string, number[]][] = [['Kitchen', crew.cook], ['Front', crew.front]];
  if (delivery) crewRows.push(['Drivers', crew.driver]);
  const H = T + CH + 18 + crewRows.length * rowH + 4;
  const want = rows.map((r) => r.walk + r.delivery);
  const max = Math.max(4, ...want, ...rows.map((r) => Math.min(r.capacity, Math.max(...want) * 1.6)));
  const slot = (W - L - R) / 12;
  const y = (v: number) => T + (1 - Math.min(v, max) / max) * CH;
  let g = '';
  const step = max > 60 ? 20 : max > 24 ? 10 : 5;
  for (let v = 0; v <= max; v += step) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 4}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`;
  for (let i = 0; i < 12; i++) {
    const x = L + i * slot + slot * 0.16, bw = slot * 0.68;
    const w = want[i], s = Math.min(w, rows[i].served);
    const miss = Math.max(0, w - s);
    g += `<rect x="${x.toFixed(1)}" y="${y(s).toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + CH - y(s)).toFixed(1)}" rx="2" fill="#4f9a55"><title>${clock(OPEN_MIN + i * 60)}: ~${Math.round(w)} expected, ~${Math.round(s)} served</title></rect>`;
    if (miss > 0.4) g += `<rect x="${x.toFixed(1)}" y="${y(w).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(s) - y(w)).toFixed(1)}" rx="2" fill="#d8402b"><title>~${Math.round(miss)} would leave: ${LIMIT_LABEL[rows[i].limit]}</title></rect>`;
  }
  // capacity: one unbroken step line across the day
  let d = '';
  for (let i = 0; i < 12; i++) {
    const cy = y(rows[i].capacity).toFixed(1);
    const x0 = (L + i * slot).toFixed(1), x1 = (L + (i + 1) * slot).toFixed(1);
    d += `${i ? 'L' : 'M'}${x0} ${cy} L${x1} ${cy} `;
  }
  g += `<path d="${d}" fill="none" stroke="#3b2a20" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>`;
  for (let i = 0; i < 12; i += 2) g += `<text class="ax" x="${(L + i * slot + slot / 2).toFixed(1)}" y="${T + CH + 13}" text-anchor="middle">${clock(OPEN_MIN + i * 60).replace(':00', '')}</text>`;
  crewRows.forEach(([name, xs], k) => {
    const ry = T + CH + 18 + k * rowH;
    g += `<text class="ax" x="${L - 4}" y="${ry + 10.5}" text-anchor="end">${name}</text>`;
    for (let i = 0; i < 12; i++) {
      const n = xs[i];
      const bad = n === 0;
      g += `<rect x="${(L + i * slot + 1).toFixed(1)}" y="${ry}" width="${(slot - 2).toFixed(1)}" height="${rowH - 3}" rx="3" fill="${bad ? '#f7dcd6' : '#efe4d0'}"/><text x="${(L + i * slot + slot / 2).toFixed(1)}" y="${ry + 9.5}" text-anchor="middle" class="crew-n${bad ? ' bad' : ''}">${n}</text>`;
    }
  });
  return `<div class="chart plan-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Customers per hour, expected and servable, and who is working">${g}</svg>
    <div class="chips" style="margin-top:4px"><span class="chip"><span class="swatch" style="background:#4f9a55;width:9px;height:9px"></span>Served</span><span class="chip"><span class="swatch" style="background:#d8402b;width:9px;height:9px"></span>Would leave</span><span class="chip"><span class="swatch" style="background:none;border-top:2px dashed #3b2a20;width:12px;height:0;border-radius:0"></span>Room for</span></div></div>`;
}

/** Which marketing campaign would fill spare room without overflowing, if any. */
function promoPick(s: GameState, st: Store, rows: HourRow[]) {
  if (st.campaigns.length) return { kind: 'running' as const };
  const demand = rows.reduce((a, r) => a + r.walk, 0);
  const lost = rows.reduce((a, r) => a + Math.max(0, r.walk - r.capacity), 0);
  if (demand > 0 && lost / demand > 0.05) return { kind: 'full' as const, lost };
  // how much more walk-in traffic the busiest hours could take
  const busy = rows.filter((r) => r.walk >= Math.max(...rows.map((q) => q.walk)) * 0.6);
  const room = Math.min(...busy.map((r) => r.capacity / Math.max(1, r.walk))) - 1;
  if (room < 0.15) return { kind: 'snug' as const };
  const opts = CAMPAIGNS.filter((c) => c.id !== 'coupon' && s.level >= c.req && c.cost <= s.cash * 0.35 && c.boost <= room + 0.05).sort((a, b) => b.boost - a.boost);
  return opts.length ? { kind: 'pick' as const, c: opts[0], room } : { kind: 'room' as const, room };
}

export function planModalHtml(s: GameState, st: Store, which: 'today' | 'tomorrow'): string {
  const day = which === 'today' ? s.day : s.day + 1;
  const dow = (day - 1) % 7;
  const weather = which === 'today' ? s.weather : s.forecast;
  const apply = <T,>(fn: () => T) => (which === 'tomorrow' ? withSchedule(st, dow, fn) : fn());
  const sum = apply(() => daySummary(s, st, which));
  const crew = apply(() => crewByHour(st));
  const gaps = apply(() => staffingGaps(s, st, planDay(s, which)));
  const delivery = st.upgrades.delivery > 0 && !st.deliveryOff;
  const checks: Check[] = [];

  // customers
  const pct = sum.demand ? sum.served / sum.demand : 1;
  checks.push({
    key: 'cust', tone: pct >= 0.96 ? 'good' : pct >= 0.85 ? 'warn' : 'bad', icon: 'staff',
    title: `~${Math.round(sum.demand)} customers expected`,
    body: pct >= 0.96 ? `You have room for all of them (about ${Math.round(sum.served)}).` : `Room for about ${Math.round(sum.served)}. ${sum.limit ? `${LIMIT_LABEL[sum.limit]} is the bottleneck: ${LIMIT_FIX[sum.limit].replace(/\.+$/, '')}.` : ''}`,
  });

  // stock: what the morning truck will bring
  const lines = which === 'today' ? truckLines(s, st) : suggestOrder(s, st, 'tomorrow');
  const items = Object.entries(lines).filter(([, q]) => (q ?? 0) > 0) as [IngId, number][];
  const cost = items.reduce((a, [k, q]) => a + ingredientPrice(s, st, k) * q, 0);
  const soon = shortages(s).find((x) => x.phase === 'now' || x.inDays <= 2);
  const ordered = which === 'today' && st.truckDay === s.day;
  checks.push({
    key: 'stock', tone: cost > s.cash ? 'bad' : soon ? 'warn' : 'good', icon: 'stock',
    title: items.length ? `Truck: ${plural(items.length, 'item')}, ${money(cost)}` : ordered ? 'Truck ordered' : 'No truck needed',
    body: (items.length ? `${items.slice(0, 4).map(([k, q]) => `${q} ${ING[k].name.toLowerCase()}`).join(', ')}${items.length > 4 ? ` and ${items.length - 4} more` : ''}. Covers the forecast plus a buffer.` : 'You have enough on the shelves for the forecast.')
      + (cost > s.cash ? ` You have ${money(s.cash)}, so it'll order what you can afford.` : '')
      + (soon ? ` ${shortageChip(s, soon)}.` : ''),
    act: { label: 'Adjust', act: 'goto-stock' },
  });

  // staff: the schedule against the forecast
  const short = gaps.gaps.filter((g) => !g.equip);
  const working = st.staff.filter((x) => x.status === 'active' && !x.offToday).length;
  const noOne = (['cook', 'front'] as const).filter((r) => crew[r].some((n) => n === 0));
  checks.push({
    key: 'staff', tone: noOne.length ? 'bad' : short.length ? 'warn' : 'good', icon: 'staff',
    title: noOne.length ? `No ${noOne.map((r) => ROLES[r].name.toLowerCase()).join(' or ')} for part of the day` : short.length ? `${plural(working, 'person', 'people')} on, a little short` : `${plural(working, 'person', 'people')} on, covered`,
    body: short.length ? `Short ${short.map((g) => `${g.extra} ${ROLES[g.role].name.toLowerCase()} at ${g.window}`).join(' and ')}.${st.staff.some((x) => x.role === 'manager') ? ' Your manager can text the crew for help when the rush hits.' : ' A new hire can start right away, or expect a busy rush.'}` : noOne.length ? 'Check the schedule: those hours have nobody in that role.' : 'Everyone the forecast needs is on the schedule.',
    act: { label: 'Schedule', act: 'plan-tab', extra: 'data-tab="staff"' },
  });

  // promo
  const p = promoPick(s, st, sum.rows);
  const promo: Check = p.kind === 'running' ? { key: 'promo', tone: 'good', icon: 'marketing', title: 'Promo running', body: `${st.campaigns.map((c) => CAMPAIGNS.find((q) => q.id === c.id)?.name).join(', ')} is already bringing people in.` }
    : p.kind === 'full' ? { key: 'promo', tone: 'good', icon: 'marketing', title: 'Skip the promo', body: 'You\'re already busier than you can handle. Fix the bottleneck first.' }
    : p.kind === 'snug' ? { key: 'promo', tone: 'good', icon: 'marketing', title: 'No promo needed', body: 'The rushes already fill your room nicely.' }
    : p.kind === 'pick' ? { key: 'promo', tone: 'warn', icon: 'marketing', title: `Promo recommended: ${p.c.name}`, body: `There's room for about ${Math.round(p.room * 100)}% more customers at the rushes. ${p.c.desc}`, act: { label: `Run it ${money(p.c.cost)}`, act: 'plan-campaign', extra: `data-id="${p.c.id}"` } }
    : { key: 'promo', tone: 'good', icon: 'marketing', title: 'Room to grow', body: `About ${Math.round(p.room * 100)}% spare at the rushes. Marketing could fill it when you have the cash.`, act: { label: 'Marketing', act: 'plan-tab', extra: 'data-tab="marketing"' } };
  checks.push(promo);

  const allGood = checks.every((c) => c.tone === 'good');
  const card = (c: Check) => `<div class="plan-check ${c.tone}">
      <span class="pc-ic">${icon(toneIcon[c.tone], 16)}</span>
      <div class="grow"><div class="pc-title">${esc(c.title)}</div><div class="t-meta">${esc(c.body)}</div></div>
      ${c.act ? `<button class="btn tiny" data-act="${c.act.act}" ${c.act.extra ?? ''}>${esc(c.act.label)}</button>` : ''}
    </div>`;
  const go = s.gameOver ? '' : which === 'tomorrow'
    ? `<button class="btn red block big-cta" data-act="plan-go">${icon('door', 20)} ${items.length ? 'Order the truck and open' : 'Open'} day ${day}</button><button class="btn block" data-act="next-day">Start day ${day} in morning prep instead</button>`
    : s.phase === 'prep' ? `<button class="btn red block big-cta" data-act="plan-go">${icon('door', 20)} ${items.length ? 'Order the truck and open' : 'Open for business'}</button>` : '';
  return `<div class="modal plan" role="dialog" aria-label="Day plan" style="width:min(560px,100%)">
    <h2>${which === 'today' ? "Today's plan" : "Tomorrow's plan"}</h2>
    <p class="t-meta plan-sub">${esc(loc(st).name)} · day ${day} · ${DAY_NAMES[dow]} · <span class="wx">${icon(weather, 13)} ${WEATHER[weather].name}</span>${allGood ? ' · <span class="pos">Ready to go</span>' : ''}</p>
    <div class="plan-checks">${checks.map(card).join('')}</div>
    ${go ? `<div class="btns" style="flex-direction:column;margin:0 0 10px">${go}</div>` : ''}
    <details class="plan-hours"><summary>Hour by hour</summary>
      ${planChart(sum.rows, crew, delivery)}
      <p class="t-meta">Green is who you can serve, red is who'd walk out. The dashed line is how many orders an hour the crew and equipment can handle; the rows underneath are who's on.</p>
    </details>
    <div class="btns"><button class="btn block" data-act="close-modal">Close</button></div>
  </div>`;
}

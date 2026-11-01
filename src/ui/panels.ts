// Management panels rendered as HTML strings. Buttons carry data-act attributes that
// the app routes to core actions (see ui/app.ts handleAction).
import { INGREDIENTS, ING, ITEM, MENU, SUPPLIERS, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPGRADES, UPG } from '../data/upgrades';
import { CAMPAIGNS, LOCATIONS, LOANS, LOAN_DAYS, LOYALTY, ROLES, TRAITS, MAX_STAFF, MAX_MANAGERS, DRIVER_ROAD_WAGE, LOC, SHIFTS, DELIVERY_FEE, OPEN_MIN, SPECIAL_WINDOWS, SPECIAL_PCTS, MAX_SPECIALS, shiftHours, SHIFT_ORDER, HOURS_LABEL, JOB_AD, DAY_NAMES, RARE_TRAITS, type ShiftId, type SpecialWindow, type TraitId } from '../data/world';
import type { GameState, Store, Staff } from '../core/types';
import { DIFFICULTY, activeStaff, canAutoReorder, dailyWages, loc, onShiftAt, stockOf, storageCap, storageUsed, storageTomorrow, up, forecastAccuracy, orderBuffer, orderingManager } from '../core/state';
import { estimateDailyNeed, expiringTonight, neededIngredients, onHandFor, daysOfCover, expressCost, expressTerms, bufferMult, EXPRESS_MIN } from '../core/inventory';
import { ingredientPrice, itemFoodCost, priceWeight, salePrice, marketingBoost, walkInRate, fairPrice, activeSpecial, specialAppeal } from '../core/economy';
import { marketWage, moodLabel, trainingCost, trainingCostFor, trainingReq, xpToNext, QUIT_LINE, performance, dealRating } from '../core/staff';
import { orderTarget, pizzaShare, runsOutAt, daySummary, LIMIT_LABEL, planDay, staffingGaps, withSchedule, ctxForDay, equipFix, type Gap } from '../core/forecast';
import { activeGoals, unlocksAt, xpForLevel, GOALS } from '../core/progression';
import { upgradeCost, clearanceIdeas, firstEditableDay } from '../core/actions';
import { recommendHires } from '../core/manager';
import { nextAccolade } from '../core/fun';
import { shortages, shortageFor, shortageChip, shortageAdvice, stockUpPlan } from '../core/shortage';
import { money, compactMoney, clock, plural } from '../core/util';
import { pizzaRating, esc, icon, meter, stars } from './dom';

export type TabId = 'staff' | 'stock' | 'menu' | 'upgrades' | 'marketing' | 'finance' | 'empire' | 'goals';
export const TABS: { id: TabId; label: string; short: string; icon: string; key: string }[] = [
  { id: 'staff', label: 'Staff', short: 'Staff', icon: 'staff', key: 's' },
  { id: 'stock', label: 'Stock', short: 'Stock', icon: 'stock', key: 'i' },
  { id: 'menu', label: 'Menu', short: 'Menu', icon: 'menu', key: 'm' },
  { id: 'upgrades', label: 'Upgrades', short: 'Build', icon: 'upgrades', key: 'u' },
  { id: 'marketing', label: 'Marketing', short: 'Promo', icon: 'marketing', key: 'k' },
  { id: 'finance', label: 'Finance', short: 'Money', icon: 'finance', key: 'f' },
  { id: 'empire', label: 'Empire', short: 'Stores', icon: 'empire', key: 'e' },
  { id: 'goals', label: 'Goals', short: 'Goals', icon: 'goals', key: 'g' },
];

export interface PanelCtx {
  s: GameState;
  st: Store;
  sub: Record<string, string>;
  cart: Partial<Record<IngId, number>>;
  confirmFire: number | null;
  focusUpgrade: string | null;
}

const ROLE_COLOR: Record<string, string> = { cook: '#8a6f5a', front: '#c8352a', driver: '#2f6fd1', manager: '#2b1d14' };
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);

function seg(key: string, cur: string, opts: [string, string][]) {
  return `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-act="sub" data-key="${key}" data-v="${v}" data-top="1" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
}
function pips(n: number, max = 5) {
  let s = '<span class="num" aria-label="skill ' + n + ' of ' + max + '" style="letter-spacing:1px;color:var(--tomato)">';
  for (let i = 1; i <= max; i++) s += i <= n ? '●' : '<span style="color:rgba(138,111,90,0.4)">●</span>';
  return s + '</span>';
}
const lockChip = (lv: number) => `<span class="chip">${icon('lock', 12)} Level ${lv}</span>`;

// =================================================================== STAFF
const ROLE_ORDER: Staff['role'][] = ['manager', 'cook', 'front', 'driver'];
const MOOD_DOT = (m: number) => `<span class="mood-dot ${m >= 60 ? 'good' : m >= 35 ? 'warn' : 'bad'}" title="Morale ${Math.round(m)}"></span>`;

/** 12 hourly cells: green when the team can serve everyone expected, amber when tight, red when short. */
function coverageStrip(rows: { h: number; walk: number; capacity: number }[]) {
  return `<div class="cover-strip" role="img" aria-label="Hourly coverage">${rows.map((r) => {
    const ratio = r.walk / Math.max(0.1, r.capacity);
    const tone = r.walk < 0.5 ? 'idle' : ratio > 1.08 ? 'bad' : ratio > 0.85 ? 'warn' : 'good';
    return `<span class="c ${tone}" title="${clock(OPEN_MIN + r.h * 60)}: ~${Math.round(r.walk)} customers, room for ~${Math.round(r.capacity)}"></span>`;
  }).join('')}</div><div class="cover-axis"><span>10a</span><span>12p</span><span>2p</span><span>4p</span><span>6p</span><span>8p</span><span>10p</span></div>`;
}

function gapLines(gaps: Gap[], idle: { window: 'lunch' | 'dinner'; role: 'cook' | 'front' }[]) {
  const W = { lunch: 'Lunch (10–4)', dinner: 'Dinner (4–close)' };
  let h = '';
  for (const g of gaps) h += g.equip ? `<div class="gap-line">${icon('info', 14)}<span><b>${W[g.window]}: equipment is the limit</b> <span class="t-meta">· ${equipFix(g)}</span></span></div>` : `<div class="gap-line bad">${icon('alert', 14)}<span><b>${W[g.window]}: add ${g.extra > 3 ? '3+' : g.extra} ${ROLES[g.role].name.toLowerCase()}</b> <span class="t-meta">· busiest ${clock(OPEN_MIN + g.peak * 60)}, ~${Math.round(g.short)} customers/hr would go unserved</span></span></div>`;
  for (const g of idle) h += `<div class="gap-line">${icon('info', 14)}<span><b>${W[g.window]}:</b> more ${ROLES[g.role].plural.toLowerCase()} than the rush needs <span class="t-meta">· a shorter shift or a day off saves wages</span></span></div>`;
  if (!gaps.length && !idle.length) h += `<div class="gap-line good">${icon('check', 14)}<span>Staffing matches the forecast.</span></div>`;
  return h;
}

export function staffPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.staff ?? 'team';
  let h = seg('staff', sub, [['team', `Team (${st.staff.length})`], ['schedule', 'Schedule'], ['hire', `Hire (${st.candidates.length})`]]);
  if (sub === 'hire') return h + hirePanel(c);
  if (sub === 'schedule') return h + schedulePanel(c);
  const which = s.phase === 'report' ? 'tomorrow' : 'today';
  const ctx = planDay(s, which);
  const plan = withSchedule(st, which === 'tomorrow' ? s.day % 7 : (s.day - 1) % 7, () => staffingGaps(s, st, ctx));
  const wages = dailyWages(st);
  const last = st.history[st.history.length - 1];
  const ticket = last && last.served > 10 ? last.revenue / last.served : 14;
  const expSales = plan.rows.reduce((a, r) => a + r.served, 0) * ticket;
  const labor = expSales > 0 ? (wages / expSales) * 100 : 0;
  h += `<div class="ticket">
    <div class="spread"><span class="t-name" style="font-size:15px">${which === 'today' ? 'Today' : 'Tomorrow'} · ${HOURS_LABEL}</span></div>
    <dl class="kv" style="margin-top:6px"><dt>Wages</dt><dd>${money(wages)}</dd><dt>Labor cost</dt><dd class="${labor > 35 ? 'neg' : labor && labor < 30 ? 'pos' : ''}">${labor ? `${Math.round(labor)}% of expected sales` : '—'} <span class="t-meta">(aim for 25–30%)</span></dd></dl>
    ${coverageStrip(plan.rows)}
    <div style="margin-top:8px">${gapLines(plan.gaps, plan.idle)}</div>
    <div class="t-meta" style="margin-top:6px">Shifts come from the schedule. Today and tomorrow are locked in; plan further ahead on the Schedule tab.</div></div>`;
  if (!st.staff.some((x) => x.role === 'front')) h += `<div class="ticket"><div class="row">${icon('alert', 18)}<div class="grow t-meta">No front-of-house staff: your kitchen crew has to take orders and run food too. Hire someone from the Hire tab.</div></div></div>`;
  const atRisk = st.staff.filter((x) => x.morale < 30);
  if (atRisk.length) h += `<div class="ticket"><div class="row">${icon('alert', 18)}<div class="grow t-meta"><b>${esc(atRisk.map((x) => x.name).join(', '))}</b> ${atRisk.length > 1 ? 'are' : 'is'} unhappy. Staff below ${QUIT_LINE} morale for two nights in a row usually quit.</div></div></div>`;
  if (!st.staff.length) return h + `<div class="ticket"><p class="t-meta">Nobody works here yet. Hire kitchen crew and front-of-house staff to open.</p></div>`;
  // view + filter
  const view = c.sub.staffView ?? 'shift';
  const filt = c.sub.staffRole ?? 'all';
  h += `<div class="row wrap" style="gap:8px;margin:4px 0 8px">${seg('staffView', view, [['shift', 'By shift'], ['role', 'By role']]).replace('class="seg"', 'class="seg" style="margin:0;flex:0 0 auto"')}
    ${seg('staffRole', filt, [['all', 'All'], ['cook', 'Kitchen'], ['front', 'Front'], ...(st.staff.some((x) => x.role === 'driver') ? [['driver', 'Drivers'] as [string, string]] : []), ...(st.staff.some((x) => x.role === 'manager') ? [['manager', 'Mgr'] as [string, string]] : [])]).replace('class="seg"', 'class="seg" style="margin:0;flex:1 1 auto"')}</div>`;
  const list = st.staff.filter((x) => filt === 'all' || x.role === filt);
  const open = Number(c.sub.staffOpen ?? 0);
  const groups: [string, Staff[]][] = [];
  if (view === 'role') {
    for (const r of ROLE_ORDER) {
      const g = list.filter((x) => x.role === r);
      if (g.length) groups.push([ROLES[r].plural, g]);
    }
  } else {
    const off = list.filter((x) => x.offToday || x.status === 'sick');
    for (const k of ['full', ...SHIFT_ORDER.filter((k) => k !== 'full')] as ShiftId[]) {
      const g = list.filter((x) => x.shift === k && !off.includes(x));
      if (g.length) groups.push([`${SHIFTS[k].name} · ${clock(SHIFTS[k].start)}–${SHIFTS[k].end >= 22 * 60 ? 'close' : clock(SHIFTS[k].end)}`, g]);
    }
    if (off.length) groups.push(['Off today', off]);
  }
  for (const [label, g] of groups) {
    const cost = g.reduce((a, x) => a + (x.status === 'active' && !x.offToday ? x.wage * shiftHours(x.shift) : 0), 0);
    const key = 'grp_' + label.replace(/[^a-z]/gi, '').slice(0, 24);
    const shut = c.sub[key] === '0';
    // in the role view, say whether this role covers the forecast today
    const role = view === 'role' ? g[0].role : null;
    const gap = role ? plan.gaps.filter((q) => q.role === role && !q.equip) : [];
    const cov = !role || role === 'manager' ? '' : role === 'driver' ? '' : gap.length ? `<span class="chip bad">Short ${gap.map((q) => `${q.extra} at ${q.window}`).join(', ')}</span>` : `<span class="chip good">${icon('check', 11)} Covered</span>`;
    const on = g.filter((x) => x.status === 'active' && !x.offToday).length;
    h += `<button class="grp-head${shut ? ' shut' : ''}" data-act="sub" data-key="${key}" data-v="${shut ? '' : '0'}" aria-expanded="${!shut}">
      <span class="chev">${shut ? '▸' : '▾'}</span><span class="grow"><span class="grp-name">${esc(label)}</span><span class="t-meta"> · ${view === 'role' ? `${on} of ${g.length} on today` : g.length}</span></span>${cov}<span class="t-meta num">${cost ? money(cost) + '/day' : ''}</span></button>`;
    if (!shut) h += `<div class="staff-list">${g.map((x) => staffRow(c, x, open === x.id)).join('')}</div>`;
  }
  return h;
}

function staffRow(c: PanelCtx, x: Staff, open: boolean): string {
  const { s } = c;
  const status = x.status === 'sick' ? '<span class="chip bad">Sick</span>' : x.offToday ? '<span class="chip">Day off</span>' : `<span class="chip">${SHIFTS[x.shift].short}</span>`;
  const p = performance(c.st, x);
  return `<div class="staff-item ${open ? 'open' : ''}">
    <button class="staff-row" data-act="sub" data-key="staffOpen" data-v="${open ? 0 : x.id}" aria-expanded="${open}">
      <span class="avatar sm" style="background:${ROLE_COLOR[x.role]}">${esc(initials(x.name))}</span>
      <span class="grow"><b>${esc(x.name)}</b><span class="t-meta"> ${ROLES[x.role].name} · ${pips(x.skill)}${p.grade !== '—' ? ` · grade ${p.grade}` : ''}</span></span>
      ${status}${MOOD_DOT(x.morale)}<span class="num t-meta">${money(x.wage, true)}</span><span class="chev">${open ? '▴' : '▾'}</span>
    </button>
    ${open ? staffCard(c, x) : ''}
  </div>`;
  void s;
}

const SHIFT_CELL: Record<string, string> = { open8: 'Open', close8: 'Close', full: 'OP-CL', lunch: 'Morn', mid: 'L-Rush', dinner: 'Dinner', evening: 'D-Rush', off: 'X' };
const HALF = { lunch: 'lunch', dinner: 'dinner' } as const;

interface DayPlan { day: number; dow: number; locked: boolean; gaps: Gap[]; idle: { window: 'lunch' | 'dinner'; role: 'cook' | 'front' }[]; wages: number; sales: number }

/** Coverage, wages and expected sales for each day shown on the schedule. */
function weekPlans(s: GameState, st: Store, days: number[]): DayPlan[] {
  const last = st.history[st.history.length - 1];
  const ticket = last && last.served > 10 ? last.revenue / last.served : 14;
  return days.map((day) => {
    const dow = (day - 1) % 7;
    const g = withSchedule(st, dow, () => staffingGaps(s, st, ctxForDay(s, day)));
    let wages = 0;
    for (const x of st.staff) {
      const v = st.schedule[x.id]?.[dow] ?? x.shift;
      if (v !== 'off') wages += x.wage * shiftHours(v);
    }
    return { day, dow, locked: day < firstEditableDay(s), gaps: g.gaps, idle: g.idle, wages, sales: g.rows.reduce((a, r) => a + r.served, 0) * ticket };
  });
}

/** One line of advice: the most useful thing to fix on the schedule right now. */
function scheduleTip(s: GameState, st: Store, plans: DayPlan[]): { tone: 'bad' | 'warn' | 'good'; text: string } {
  const dayName = (p: DayPlan) => (p.day === s.day ? 'Today' : p.day === s.day + 1 ? 'Tomorrow' : DAY_NAMES[p.dow]);
  const open = plans.filter((p) => !p.locked);
  const worst = (ps: DayPlan[]) => ps.flatMap((p) => p.gaps.filter((g) => !g.equip).map((g) => ({ p, g }))).sort((a, b) => b.g.short - a.g.short)[0];
  const w = worst(open);
  if (w) {
    const fix = w.g.window === 'lunch' ? 'Morning or Lunch Rush' : 'Dinner or Dinner Rush';
    // is anyone in that role actually free that day, with fewer than six days on this week?
    const hoursOn = (x: Staff) => plans.reduce((a, p) => { const v = st.schedule[x.id]?.[p.dow] ?? x.shift; return a + (v === 'off' ? 0 : shiftHours(v)); }, 0);
    const spare = st.staff.some((x) => x.role === w.g.role && (st.schedule[x.id]?.[w.p.dow] ?? x.shift) === 'off' && hoursOn(x) <= 42);
    const who = `${w.g.extra > 3 ? '3+' : w.g.extra} ${w.g.extra === 1 ? ROLES[w.g.role].name.toLowerCase() : ROLES[w.g.role].plural.toLowerCase()}`;
    return { tone: 'bad', text: spare
      ? `${dayName(w.p)} ${HALF[w.g.window]} is short ${who} at the ${clock(OPEN_MIN + w.g.peak * 60)} rush. Add a ${fix} shift, or tap Suggest and it's sorted.`
      : st.staff.length >= MAX_STAFF
        ? `${dayName(w.p)} ${HALF[w.g.window]} is a little short on ${ROLES[w.g.role].plural.toLowerCase()}, and you're at the ${MAX_STAFF}-person limit. Training the crew or a faster make line or registers will cover it.`
        : `${dayName(w.p)} ${HALF[w.g.window]} is short ${who}, and everyone in that role already has a full 40-hour week. Time to hire another ${ROLES[w.g.role].name.toLowerCase()}.` };
  }
  const lw = worst(plans.filter((p) => p.locked));
  if (lw) return { tone: 'warn', text: `${dayName(lw.p)} looks short at ${HALF[lw.g.window]} on ${ROLES[lw.g.role].plural.toLowerCase()}, but it's locked in. Expect a busy shift, or hire someone who can start right away.` };
  const eq = plans.flatMap((p) => p.gaps.filter((g) => g.equip).map((g) => ({ p, g })))[0];
  if (eq) return { tone: 'warn', text: `${dayName(eq.p)} ${HALF[eq.g.window]} is busier than the store can handle: ${equipFix(eq.g)}.` };
  const idle = open.find((p) => p.idle.length);
  if (idle) return { tone: 'warn', text: `${dayName(idle)} ${HALF[idle.idle[0].window]} has more ${ROLES[idle.idle[0].role].plural.toLowerCase()} than the rush needs. A rush shift or a day off saves wages.` };
  const wages = plans.reduce((a, p) => a + p.wages, 0), sales = plans.reduce((a, p) => a + p.sales, 0);
  const labor = sales ? (wages / sales) * 100 : 0;
  if (labor > 33) return { tone: 'warn', text: `Labor is about ${Math.round(labor)}% of expected sales this week. Suggest a schedule trims shifts the forecast doesn't need.` };
  const opcl = open.filter((p) => st.staff.some((x) => st.schedule[x.id]?.[p.dow] === 'full')).length;
  if (opcl >= 3 && !up(st, 'breakroom').morale) return { tone: 'warn', text: 'Lots of OP-CL shifts and no breakroom: twelve hours on their feet wears people down. Covered, but watch morale.' };
  return { tone: 'good', text: `Every day is covered${labor ? ` and labor is a healthy ${Math.round(labor)}% of sales` : ''}. Nice work.` };
}

function schedulePanel(c: PanelCtx): string {
  const { s, st } = c;
  const first = s.phase === 'report' ? s.day + 1 : s.day;
  const days = Array.from({ length: 7 }, (_, i) => first + i);
  const plans = weekPlans(s, st, days);
  const team = ROLE_ORDER.flatMap((r) => st.staff.filter((x) => x.role === r));
  const wages = plans.reduce((a, p) => a + p.wages, 0), sales = plans.reduce((a, p) => a + p.sales, 0);
  const labor = sales ? Math.round((wages / sales) * 100) : 0;
  const tip = scheduleTip(s, st, plans);
  const mgr = st.staff.find((x) => x.role === 'manager' && x.status === 'active');
  const [pickId, pickDay] = (c.sub.schedPick ?? '').split(':').map(Number);
  let h = `<div class="ticket sched-head">
    <div class="spread"><div><div class="t-name" style="font-size:16px">This week</div><div class="t-meta">${DAY_NAMES[(first - 1) % 7]} to ${DAY_NAMES[(first + 5) % 7]} · days ${first}–${first + 6}</div></div>
      <div style="text-align:right"><div class="price">${money(wages)}</div><div class="t-meta ${labor > 33 ? 'neg' : labor && labor <= 30 ? 'pos' : ''}">${labor ? `${labor}% of sales` : 'wages'}</div></div></div>
    <div class="sched-tip ${tip.tone}">${icon(tip.tone === 'good' ? 'check' : tip.tone === 'bad' ? 'alert' : 'info', 16)}<span>${esc(tip.text)}</span></div>
    <div class="btns"><button class="btn small gold" data-act="sched-suggest">${mgr ? `Ask ${esc(mgr.name.split(' ')[0])} to write it` : 'Suggest a schedule'}</button>
      <button class="btn small ${st.autoSchedule ? 'buy' : ''}" data-act="sched-auto" aria-pressed="${st.autoSchedule ? 'true' : 'false'}">${icon(st.autoSchedule ? 'check' : 'calendar', 14)} Auto-schedule ${st.autoSchedule ? 'on' : 'off'}</button></div>
    <div class="t-meta lock-note">${icon('lock', 12)}<span>Today and tomorrow are locked in. Tap any other day to change a shift. Suggest covers the forecast with full 8-hour days, up to 40 hours a week for your best people${mgr && mgr.skill >= 2 ? ', plus short rush shifts where they save wages' : ''}.${st.autoSchedule ? ' Auto-schedule rewrites it every night, so your changes last until then.' : ' Turn on auto-schedule and it rebuilds every night, adding people to tomorrow if a rush pops up.'}</span></div>
  </div>`;
  if (!team.length) return h + `<div class="ticket"><p class="t-meta">Hire someone to start building a schedule.</p></div>`;
  h += `<div class="sched-wrap"><table class="sched"><thead><tr><th class="who"></th>${plans.map((p) => `<th class="${p.locked ? 'locked' : ''} ${p.day === s.day && s.phase !== 'report' ? 'today' : ''}"><span>${DAY_NAMES[p.dow]}</span><span class="d num">${p.locked ? icon('lock', 10) : ''}${p.day}</span></th>`).join('')}</tr></thead><tbody>`;
  let lastRole = '';
  for (const x of team) {
    if (x.role !== lastRole) {
      h += `<tr class="grp"><td colspan="8">${ROLES[x.role].plural}</td></tr>`;
      lastRole = x.role;
    }
    const row = st.schedule[x.id] ?? Array(7).fill(x.shift);
    const hrs = plans.reduce((a, p) => { const v = row[p.dow] ?? x.shift; return a + (v === 'off' ? 0 : shiftHours(v)); }, 0);
    h += `<tr><td class="who" title="${esc(x.name)} · ${money(x.wage, true)}/hr · ${hrs} hours this week">${esc(x.name.split(' ')[0])}<span class="t-meta num ${hrs > 40 ? 'neg' : hrs >= 32 ? 'pos' : ''}">${hrs}h · ${money(x.wage, true)}</span></td>${plans.map((p) => {
      const v = row[p.dow] ?? x.shift;
      const sick = p.day === s.day && x.status === 'sick';
      const picked = pickId === x.id && pickDay === p.day;
      const label = sick ? 'Sick' : SHIFT_CELL[v];
      const act = p.locked ? 'data-act="sched-locked"' : `data-act="sub" data-key="schedPick" data-v="${picked ? '' : `${x.id}:${p.day}`}"`;
      return `<td><button class="cell s-${sick ? 'sick' : v}${p.locked ? ' locked' : ''}${picked ? ' picked' : ''}" ${act} aria-label="${esc(x.name)}, ${DAY_NAMES[p.dow]}: ${v === 'off' ? 'off' : SHIFTS[v].name}${p.locked ? ' (locked)' : ''}">${label}</button></td>`;
    }).join('')}</tr>`;
    if (pickId === x.id && plans.some((p) => p.day === pickDay && !p.locked)) {
      const cur = row[(pickDay - 1) % 7];
      h += `<tr class="pick"><td colspan="8"><div class="pick-box"><div class="t-meta"><b>${esc(x.name)}</b> · ${DAY_NAMES[(pickDay - 1) % 7]} (day ${pickDay})</div><div class="pick-opts">${[...SHIFT_ORDER, 'off' as const].map((k) => `<button class="cell s-${k}${cur === k ? ' on' : ''}" data-act="sched-set" data-id="${x.id}" data-d="${pickDay}" data-v="${k}">${k === 'off' ? 'X<small>Off</small>' : `${SHIFT_CELL[k]}<small>${clock(SHIFTS[k].start).replace(':00', '')}–${SHIFTS[k].end >= 22 * 60 ? 'close' : clock(SHIFTS[k].end).replace(':00', '')}</small>`}</button>`).join('')}</div></div></td></tr>`;
    }
  }
  // coverage against the forecast: lunch and dinner halves
  const pill = (p: DayPlan, w: 'lunch' | 'dinner') => {
    const g = p.gaps.filter((q) => q.window === w && !q.equip);
    const eq = p.gaps.some((q) => q.window === w && q.equip);
    const idle = p.idle.some((q) => q.window === w);
    const n = g.reduce((a, q) => a + q.extra, 0);
    const why = g.map((q) => `+${q.extra} ${ROLES[q.role].name}`).join(', ');
    return `<span class="cov ${n ? 'bad' : idle || eq ? 'warn' : 'good'}" title="${w === 'lunch' ? 'Lunch 10–4' : 'Dinner 4–close'}: ${esc(why || (eq ? 'equipment is the limit' : idle ? 'more than needed' : 'covered'))}">${w === 'lunch' ? 'L' : 'D'}${n ? `+${n}` : eq ? '!' : idle ? '~' : '✓'}</span>`;
  };
  h += `<tr class="cover"><td class="who">Cover</td>${plans.map((p) => `<td><div class="cov-pair">${pill(p, 'lunch')}${pill(p, 'dinner')}</div></td>`).join('')}</tr>`;
  h += `<tr class="labor"><td class="who">Labor</td>${plans.map((p) => {
    const pct = p.sales ? Math.round((p.wages / p.sales) * 100) : 0;
    return `<td><span class="num">${compactMoney(p.wages)}</span><span class="pct ${pct > 33 ? 'neg' : pct && pct <= 30 ? 'pos' : ''}">${pct ? pct + '%' : ''}</span></td>`;
  }).join('')}</tr>`;
  h += `</tbody></table></div>`;
  h += `<div class="sched-legend t-meta"><span class="cell s-open8">Open</span> 10–6 · <span class="cell s-close8">Close</span> 2–close · <span class="cell s-full">OP-CL</span> open to close · <span class="cell s-lunch">Morn</span> 10–4 · <span class="cell s-mid">L-Rush</span> 11–3 · <span class="cell s-dinner">Dinner</span> 4–close · <span class="cell s-evening">D-Rush</span> 5–9 · <span class="cell s-off">X</span> off<br>Cover: <span class="cov good">L✓</span> lunch covered · <span class="cov bad">D+2</span> dinner needs 2 more · <span class="cov warn">L~</span> more than needed · <span class="cov warn">D!</span> equipment is the limit, not staff. Labor is that day's wages and % of expected sales (aim for 25–30%). Hours next to each name are this week's total (40 is full time).</div>`;
  return h;
}

/** Traits you can see: a diamond in the rough stays hidden until it shows, or a skilled manager spots it. */
function shownTraits(st: Store, traits: TraitId[], revealed: boolean): TraitId[] {
  const sharp = st.staff.some((y) => y.role === 'manager' && y.status === 'active' && y.skill >= 3);
  return traits.filter((t) => t !== 'diamond' || revealed || sharp);
}
const traitChip = (t: TraitId) => `<span class="chip ${RARE_TRAITS.includes(t) ? 'rare' : TRAITS[t].good ? 'good' : 'bad'}" title="${esc(TRAITS[t].desc)}">${RARE_TRAITS.includes(t) ? '✦ ' : ''}${TRAITS[t].name}</span>`;

function hirePanel(c: PanelCtx): string {
  const { s, st } = c;
  let h = `<div class="ticket"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">${st.jobAd > 0 ? `Job ad running (${plural(st.jobAd, 'day')} left)` : 'Need more choice?'}</div><div class="t-meta">Applicants stay a few days, then take other jobs. New people apply every morning${st.rating >= 4 ? ', and your rating attracts better ones' : ''}. A job ad brings 3 extra applicants with better skills.</div></div>
    ${st.jobAd > 0 ? '' : `<button class="btn small buy" data-act="job-ad" ${s.cash < JOB_AD.cost ? 'disabled' : ''}>Post ad <span class="num">${money(JOB_AD.cost)}</span></button>`}</div></div>`;
  const mgr = st.staff.find((y) => y.role === 'manager' && y.status === 'active');
  h += `<p class="hint">Wages are per hour. "Good deal" compares what they ask with what their skill and traits are worth. New hires can start right away${mgr && mgr.skill >= 3 ? `, and ${esc(mgr.name.split(' ')[0])} adds them to the schedule where they're needed` : '; add them to the schedule on the Schedule tab'}.</p>`;
  // which role the coming week is short on, from the same coverage the schedule shows
  const first = s.phase === 'report' ? s.day + 1 : s.day;
  const plans = weekPlans(s, st, Array.from({ length: 7 }, (_, i) => first + i));
  const short = plans.flatMap((p) => p.gaps.filter((g) => !g.equip)).sort((a, b) => b.short - a.short)[0];
  // a lean crew is the goal: say so when the schedule already covers everything
  const idleCrew = st.staff.filter((x) => x.role !== 'manager' && plans.every((p) => (st.schedule[x.id]?.[p.dow] ?? x.shift) === 'off'));
  if (!short && st.staff.length >= 3) h += `<div class="ticket"><div class="row">${icon('check', 18)}<div class="grow t-meta"><b>Your team covers this week's forecast.</b> Hire when the Schedule shows a gap, or to give someone a break from overtime. ${idleCrew.length ? `${esc(idleCrew.map((x) => x.name.split(' ')[0]).join(', '))} ${idleCrew.length === 1 ? "isn't" : "aren't"} on the schedule at all this week.` : ''}</div></div></div>`;
  const recs = recommendHires(s, st, short?.role ?? null);
  const recIds = new Set(recs.map((r) => r.id));
  if (recs.length) {
    const rc = st.candidates.find((x) => x.id === recs[0].id);
    if (rc) h += `<div class="ticket rec-hire"><div class="row">${icon('star', 18)}<div class="grow"><div class="t-name" style="font-size:15px">Recommended: ${esc(rc.name)} <span class="t-meta">(${ROLES[rc.role].name})</span></div><div class="t-meta">${esc(recs[0].why)}${mgr ? '' : ' A manager gives better hiring advice.'}</div></div></div></div>`;
  }
  for (const role of ROLE_ORDER) {
    const g = st.candidates.filter((x) => x.role === role).sort((a, b) => b.skill - a.skill);
    if (!g.length) continue;
    const r = ROLES[role];
    const locked = s.level < r.req || (role === 'driver' && st.upgrades.delivery < 1) || (role === 'manager' && st.staff.filter((y) => y.role === 'manager').length >= MAX_MANAGERS);
    const why = s.level < r.req ? `Unlocks at level ${r.req}` : role === 'driver' && st.upgrades.delivery < 1 ? 'Needs a delivery vehicle' : role === 'manager' && st.staff.filter((y) => y.role === 'manager').length >= MAX_MANAGERS ? `Already have ${MAX_MANAGERS} managers` : '';
    h += `<div class="section-label"><span>${r.plural} (${g.length})</span><span class="t-meta">${st.staff.filter((x) => x.role === role).length} on the team</span></div>`;
    for (const cd of g) {
      const deal = dealRating(s, cd);
      const traits = shownTraits(st, cd.traits, false);
      h += `<div class="ticket perf${recIds.has(cd.id) ? ' rec' : ''}">
        <div class="row"><div class="avatar" style="background:${ROLE_COLOR[cd.role]}">${esc(initials(cd.name))}</div>
          <div class="grow"><div class="t-name">${esc(cd.name)}${recIds.has(cd.id) ? ' <span class="chip gold-chip">Recommended</span>' : ''}</div><div class="t-meta">${r.name} · skill ${pips(cd.skill)}${cd.daysLeft && cd.daysLeft <= 1 ? ' · <span class="neg">leaving soon</span>' : ''}</div></div>
          <div style="text-align:right"><div class="price">${money(cd.wage, true)}<span class="t-meta">/hr</span></div><span class="chip ${deal.tone}" title="Worth about ${money(deal.worth, true)}/hr">${deal.label}</span></div></div>
        ${traits.length ? `<div class="chips">${traits.map(traitChip).join('')}</div>` : '<div class="chips"><span class="chip">No standout traits</span></div>'}
        <div class="t-desc">${traits.length ? traits.map((t) => `<b>${TRAITS[t].name}:</b> ${TRAITS[t].desc}`).join(' ') : r.desc}</div>
        <div class="btns">${locked ? `<span class="chip warn">${esc(why)}</span>` : `<button class="btn buy small" data-act="hire" data-id="${cd.id}" ${st.staff.length >= MAX_STAFF ? 'disabled' : ''}>Hire ${esc(cd.name.split(' ')[0])}</button>`}</div>
      </div>`;
    }
  }
  if (!st.candidates.length) h += `<div class="ticket"><p class="t-meta">No applicants right now. Check back tomorrow morning, or post a job ad.</p></div>`;
  return h;
}

function staffStatus(s: GameState, x: Staff): string {
  if (x.status === 'sick') return '<span class="chip bad">Off sick today</span>';
  if (x.callIn?.day === s.day && !x.onFloor && s.minute < x.callIn.until) return `<span class="chip good">${x.callIn.why === 'cover' ? 'Covering a sick shift' : `Coming in at ${clock(x.callIn.from)}`}</span>`;
  if (x.callIn?.day === s.day && x.onFloor && x.callIn.why === 'help') return '<span class="chip good">Came in to help</span>';
  if (x.offToday) return '<span class="chip">Day off</span>';
  const sh = SHIFTS[x.shift];
  if (s.phase === 'open' || s.phase === 'closing') {
    if (!x.onFloor) return s.minute < sh.start ? `<span class="chip">Starts ${clock(sh.start)}</span>` : '<span class="chip">Gone home</span>';
    if (!x.task) return '<span class="chip">Idle</span>';
    const label = { order: 'At the till', prep: 'Making a pizza', deliver: 'Out delivering', clean: 'Mopping', run: 'Running food', bus: 'Clearing a table', walk: 'Walking' }[x.task.kind];
    return `<span class="chip good">${label}</span>`;
  }
  return `<span class="chip">${sh.name} shift</span>`;
}

function reviewBlock(st: Store, x: Staff): string {
  const p = performance(st, x);
  if (p.days < 2) return `<div class="review-box"><b>Performance review</b><div class="t-meta">${esc(p.notes[0] ?? '')}</div></div>`;
  return `<div class="review-box"><div class="spread"><b>Performance review · last ${p.days} shifts</b><span class="grade g-${p.grade}">${p.grade}</span></div>
    <dl class="kv" style="margin-top:4px">${p.perHour !== null ? `<dt>Tasks per hour</dt><dd>${p.perHour.toFixed(1)}${p.teamAvg ? ` <span class="t-meta">(team ${p.teamAvg.toFixed(1)})</span>` : ''}</dd>` : ''}${p.busy !== null ? `<dt>Time busy</dt><dd>${Math.round(p.busy * 100)}%</dd>` : ''}<dt>Remakes</dt><dd>${p.drops}</dd></dl>
    ${p.notes.length ? `<div class="t-meta" style="margin-top:4px">${p.notes.map(esc).join(' ')}</div>` : ''}
    ${p.raise ? '<div class="t-meta pos" style="margin-top:4px">Has earned a raise.</div>' : ''}</div>`;
}

function staffCard(c: PanelCtx, x: Staff): string {
  const { s, st } = c;
  const r = ROLES[x.role];
  const market = marketWage(x.role, x.skill);
  const tCost = trainingCostFor(x);
  const tReq = trainingReq(x.skill);
  const need = xpToNext(x.skill);
  const canTrain = x.skill < 5 && !x.course && s.level >= tReq;
  const confirming = c.confirmFire === x.id;
  const mood = moodLabel(x.morale);
  const trend = x.morale - x.moraleStart;
  const busy = x.shiftMin > 20 ? Math.round((x.busyMin / x.shiftMin) * 100) : null;
  const why = x.moraleWhy.slice(0, 3);
  const first = s.phase === 'report' ? s.day + 1 : s.day;
  const week = Array.from({ length: 7 }, (_, i) => {
    const dow = (first + i - 1) % 7;
    return { dow, today: i === 0 && s.phase !== 'report', v: (i === 0 && s.phase !== 'report' ? (x.offToday ? 'off' : x.shift) : st.schedule[x.id]?.[dow] ?? x.shift) as ShiftId | 'off' };
  });
  return `<div class="staff-card">
    <div class="row"><div class="grow"><div class="t-meta">${r.name} · skill ${pips(x.skill)} · hired day ${x.hiredDay}</div></div>
      <div style="text-align:right"><div class="price">${money(x.wage, true)}<span class="t-meta">/hr</span></div><div class="t-meta">market ${money(market, true)}</div>${x.role === 'driver' ? `<div class="t-meta">${money(DRIVER_ROAD_WAGE, true)}/hr on the road + tips${x.tipsToday ? ` · ${money(x.tipsToday)} today` : ''}</div>` : ''}</div></div>
    ${(() => { const wk = (x.hoursLog ?? []).slice(-7).reduce((a, b) => a + b, 0); return wk > 40 ? `<div class="t-meta neg" style="margin-top:4px">${Math.round(wk)} hours in the last 7 days: hours past 40 are paid time and a half.</div>` : ''; })()}
    <div class="chips">${staffStatus(s, x)}${x.course ? '<span class="chip warn">Evening class tonight</span>' : ''}${shownTraits(st, x.traits, !!x.revealed).map(traitChip).join('')}${x.boost?.day === s.day ? `<span class="chip good">${esc(x.boost.why)}</span>` : ''}</div>
    <dl class="kv" style="margin:10px 0 0">
      <dt>Morale</dt><dd>${meter(x.morale)} ${Math.round(x.morale)} <span class="chip ${mood.tone}" style="margin-left:4px">${mood.label}</span>${Math.abs(trend) >= 1 ? ` <span class="${trend > 0 ? 'pos' : 'neg'}">${trend > 0 ? '▲' : '▼'}${Math.abs(Math.round(trend))}</span>` : ''}</dd>
      <dt>Energy</dt><dd>${meter(x.energy)} ${Math.round(x.energy)}</dd>
      ${busy !== null ? `<dt>Busy today</dt><dd>${meter(busy, 100, busy > 85 ? 'bad' : busy > 70 ? 'warn' : 'good')} ${busy}%</dd>` : ''}
      <dt>Experience</dt><dd>${x.skill >= 5 ? 'Max skill' : `${meter(x.xp, need, 'gold')} ${Math.floor(x.xp)}/${need} min`}</dd>
    </dl>
    ${reviewBlock(st, x)}
    ${why.length ? `<div class="t-meta" style="margin-top:6px">Last night: ${why.map((w) => `<span class="${w.v >= 0 ? 'pos' : 'neg'}">${esc(w.label)} (${w.v >= 0 ? '+' : ''}${Math.round(w.v)})</span>`).join(' · ')}</div>` : ''}
    <div class="row wrap" style="margin-top:10px;gap:8px">
      <div class="week-strip" aria-label="This week's shifts">${week.map((w) => `<span class="cell s-${w.v}${w.today ? ' today' : ''}" title="${DAY_NAMES[w.dow]}: ${w.v === 'off' ? 'off' : SHIFTS[w.v].name}"><small>${DAY_NAMES[w.dow].slice(0, 2)}</small>${SHIFT_CELL[w.v]}</span>`).join('')}</div>
      <div class="stepper" title="Hourly wage"><button data-act="wage" data-id="${x.id}" data-d="-0.25" aria-label="Cut 25 cents">${icon('minus', 14)}</button><span class="val-in">$<input class="num-in" type="number" inputmode="decimal" step="0.25" min="7.25" data-input="wage-set" data-id="${x.id}" value="${x.wage.toFixed(2)}" aria-label="Hourly wage for ${esc(x.name)}"></span><button data-act="wage" data-id="${x.id}" data-d="0.25" aria-label="Raise 25 cents">${icon('plus', 14)}</button></div>
    </div>
    <div class="btns">
      ${x.skill < 5 ? `<button class="btn small ${canTrain ? 'gold' : ''}" data-act="train" data-id="${x.id}" ${canTrain ? '' : 'disabled'} title="${s.level < tReq ? 'Unlocks at level ' + tReq : x.course ? 'Already signed up' : 'Evening class: no time off, skill +1 tomorrow morning'}">${x.course ? 'Signed up' : 'Train'} <span class="num">${money(tCost)}</span></button>` : ''}
      <button class="btn small" data-act="bonus" data-id="${x.id}" ${x.bonusDay === s.day ? 'disabled' : ''} title="+15 morale">Bonus $100</button>
      <button class="btn small" data-act="sub" data-key="staff" data-v="schedule" data-top="1">${icon('calendar', 14)} Edit schedule</button>
      <button class="btn small ${confirming ? 'red' : ''}" data-act="fire" data-id="${x.id}">${confirming ? 'Tap again to confirm' : 'Let go'}</button>
    </div>
    <div class="t-meta" style="margin-top:6px">${x.offToday ? 'Off today.' : `Today: ${SHIFTS[x.shift].name}, ${money(x.wage * shiftHours(x.shift))}.`}${x.wage < market - 0.01 ? ` Paying ${money(market - x.wage, true)}/hr under market lowers morale every night.` : ''}</div>
  </div>`;
}

// =================================================================== STOCK
export function stockPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.stock ?? 'order';
  let h = seg('stock', sub, [['order', 'Order supplies'], ['auto', 'Auto-reorder']]);
  const target = orderTarget(s);
  const used = target === 'today' ? storageUsed(st) : storageTomorrow(st, s.day), cap = storageCap(st);
  h += `<div class="ticket"><div class="spread"><span class="t-name">${esc(up(st, 'storage').name)}</span><span class="num">${Math.round(used)} / ${cap} units</span></div>
    <div style="margin-top:6px">${meter(used, cap, used / cap > 0.9 ? 'bad' : used / cap > 0.7 ? 'warn' : 'good').replace('class="meter', 'class="meter wide')}</div>
    <div class="t-meta" style="margin-top:4px">${target === 'today' ? 'Cold storage in use' : 'Cold storage tomorrow morning (what keeps overnight plus orders on the way)'}. Boxes and soda go on dry shelves and the drinks fridge, so they don't take space.</div></div>`;
  for (const x of shortages(s)) {
    const plan = stockUpPlan(s, st, x);
    h += `<div class="ticket shortage ${x.phase}"><div class="row">${icon('alert', 18)}<div class="grow"><b>${esc(shortageChip(s, x))}</b><div class="t-meta">${esc(shortageAdvice(s, x, st))}</div>
      ${plan ? `<div class="btns"><button class="btn small gold" data-act="stock-up" data-k="${x.ing}" ${plan.cost > s.cash ? 'disabled' : ''}>Stock up: +${plan.qty} for ${plural(plan.days, 'shortage day')} <span class="num">${money(plan.cost)}</span></button></div>` : ''}</div></div></div>`;
  }
  if (sub === 'auto') return h + autoPanel(c);

  const need = neededIngredients(s, st);
  const other = INGREDIENTS.map((i) => i.id).filter((id) => !need.includes(id));
  const acc = forecastAccuracy(st);
  const buf = orderBuffer(st);
  const mgr = orderingManager(st);
  const anyMgr = st.staff.find((x) => x.role === 'manager');
  h += `<div class="ticket">
    <div class="spread"><span class="t-name" style="font-size:15px">Order buffer</span><span class="t-meta">${esc(up(st, 'software').name)}: forecasts ±${acc}%</span></div>
    <div class="seg" role="group" aria-label="Order buffer" style="margin:8px 0 0">${[['auto', `Auto ${acc}%`], ['0', '0%'], ['10', '+10%'], ['20', '+20%'], ['35', '+35%'], ['50', '+50%']].map(([v, l]) => `<button data-act="buffer" data-v="${v}" aria-pressed="${v === 'auto' ? st.orderBuffer === null : st.orderBuffer === Number(v)}">${l}</button>`).join('')}</div>
    <div class="t-meta" style="margin-top:6px">"Fill to forecast", the morning truck and auto-reorder all order the forecast <b>plus ${buf}%</b> so a busy day doesn't wipe you out. ${st.upgrades.software < 2 ? 'Better Inventory Systems (Upgrades) make forecasts tighter, so you can carry less.' : ''}</div>
    ${mgr ? `<div class="row" style="margin-top:10px"><div class="grow"><b>${esc(mgr.name)} places the morning truck</b><div class="t-meta">Orders the forecast + buffer before you open.</div></div><button class="toggle" data-act="mgr-truck" aria-pressed="${st.mgrOrders.truck}" aria-label="Manager places the morning truck"></button></div>
      <div class="row" style="margin-top:8px"><div class="grow"><b>Allow express orders</b><div class="t-meta">If something will run out, ${esc(mgr.name.split(' ')[0])} may rush it, up to this much per order.</div></div><button class="toggle" data-act="mgr-express" aria-pressed="${st.mgrOrders.express}" aria-label="Allow manager express orders"></button></div>
      ${st.mgrOrders.express ? `<div class="row" style="margin-top:6px;justify-content:flex-end"><div class="stepper" title="Express limit per order"><button data-act="mgr-limit" data-d="-50" aria-label="Lower limit">${icon('minus', 14)}</button><span class="val">${money(st.mgrOrders.limit)}</span><button data-act="mgr-limit" data-d="50" aria-label="Raise limit">${icon('plus', 14)}</button></div></div>` : ''}`
      : anyMgr ? `<div class="t-meta" style="margin-top:8px">Train ${esc(anyMgr.name)} to skill 2 and they can place the morning truck and rush express orders for you.</div>` : ''}
  </div>`;
  h += `<p class="hint">${target === 'today' ? 'Morning orders arrive right away. The forecast is for <b>today</b>.' : `Orders placed now arrive <b>tomorrow morning</b>; the forecast is for tomorrow. Express takes ${EXPRESS_MIN} min and costs a lot more.`}</p>`;
  h += `<div class="section-label"><span>Your menu needs</span><span class="row" style="gap:6px"><button class="btn tiny" data-act="cart-suggest">Fill to forecast +${buf}%</button><button class="btn tiny" data-act="cart-clear">Clear</button></span></div>`;
  h += `<div class="ticket" style="padding:0">${need.map((k) => stockRow(c, k)).join('')}</div>`;
  if (other.length) h += `<details class="more"><summary>Other ingredients (${other.length})</summary><div class="ticket" style="padding:0;margin-top:8px">${other.map((k) => stockRow(c, k)).join('')}</div></details>`;
  if (st.incoming.length) {
    const agg: Partial<Record<IngId, number>> = {};
    for (const i of st.incoming) agg[i.ing] = (agg[i.ing] ?? 0) + i.qty;
    h += `<div class="section-label">On the way</div><div class="ticket"><div class="t-meta">${Object.entries(agg).map(([k, q]) => `${q} ${esc(ING[k as IngId].name.toLowerCase())}`).join(', ')}</div></div>`;
  }
  // supplier (collapsed: it is a one-time decision)
  h += `<details class="more" style="margin-top:14px"><summary>Supplier: ${esc(SUPPLIERS[st.supplier].name)} (change)</summary>`;
  h += (Object.keys(SUPPLIERS) as SupplierId[]).map((k) => {
    const sp = SUPPLIERS[k];
    const on = st.supplier === k;
    return `<button class="choice" data-act="supplier" data-v="${k}" aria-pressed="${on}" style="${on ? 'border-color:var(--basil);box-shadow:inset 0 0 0 2px var(--basil)' : ''}">
      <b>${esc(sp.name)} ${on ? '<span class="chip good">Current</span>' : ''}</b>
      <span>Prices ×${sp.priceMult.toFixed(2)} · quality ${sp.quality > 0 ? '+' : ''}${sp.quality}. ${esc(sp.blurb)}</span></button>`;
  }).join('');
  h += `</details>`;

  // cart
  let total = 0, space = 0, lines = 0;
  for (const [k, q] of Object.entries(c.cart) as [IngId, number][]) {
    if (!q) continue;
    total += ingredientPrice(s, st, k) * q;
    space += ING[k].space * q;
    lines++;
  }
  const fits = used + space <= cap + 1e-6;
  const prep = s.phase === 'prep';
  const expressFits = storageUsed(st) + space <= cap + 1e-6;
  h += `<div class="cart-bar">
    <div class="cart-total">${lines ? `${plural(lines, 'item')} · ${Math.round(space)} cold units${fits ? '' : ' · <span class="neg">too big for storage</span>'}` : 'Cart is empty'}<b class="num">${money(total, true)}</b></div>
    ${prep
      ? `<button class="btn buy" data-act="order" data-express="0" ${lines && fits ? '' : 'disabled'}>${icon('cart', 16)} Order, arrives now</button>`
      : `<button class="btn buy small" data-act="order" data-express="0" ${lines && fits ? '' : 'disabled'}>Tomorrow AM</button>
         <button class="btn gold small" data-act="order" data-express="1" ${lines && expressFits && s.phase === 'open' ? '' : 'disabled'} title="Express: ×${expressTerms(s, st).mult.toFixed(1)} prices + ${money(15)} rush fee${expressTerms(s, st).streak > 1 ? '. Back-to-back days cost more' : ''}">${icon('bolt', 14)} Express ${EXPRESS_MIN}m <span class="num">${money(expressCost(s, st, total))}</span></button>`}
  </div>
  ${!prep && s.phase === 'open' && expressTerms(s, st).streak > 1 ? `<p class="t-meta" style="text-align:right;margin:4px 0 0">Express ${expressTerms(s, st).streak} days running: the supplier now charges ×${expressTerms(s, st).mult.toFixed(1)}. Order more on the morning truck.</p>` : ''}`;
  return h;
}

function stockRow(c: PanelCtx, k: IngId): string {
  const { s, st } = c;
  const d = ING[k];
  const have = stockOf(st, k);
  const target = orderTarget(s);
  const spoil = expiringTonight(s, st, k);
  const daily = estimateDailyNeed(s, st, k, target);
  const cover = daysOfCover(s, st, k);
  const price = ingredientPrice(s, st, k);
  const trend = s.market[k];
  const q = c.cart[k] ?? 0;
  const out = s.phase !== 'report' && daily > 0 ? runsOutAt(s, st, k) : null;
  const short = target === 'tomorrow' ? Math.max(0, daily - onHandFor(s, st, k, 'tomorrow')) : Math.max(0, daily - have);
  const sh = shortageFor(s, k);
  return `<div class="stock-row">
    <span class="swatch" style="background:${d.color}"></span>
    <div class="grow"><div class="t-name" style="font-size:15px">${esc(d.name)} ${out !== null ? `<span class="chip bad">Runs out ~${clock(out)}</span>` : short > 0 && target === 'tomorrow' ? '<span class="chip warn">Order for tomorrow</span>' : ''}${sh ? `<span class="chip ${sh.phase === 'now' ? 'bad' : 'warn'}" title="${esc(shortageAdvice(s, sh, st))}">${sh.phase === 'now' ? `Shortage: ${sh.left}d left` : sh.inDays <= 1 ? 'Shortage tomorrow: stock up' : `Shortage in ${sh.inDays}d`}</span>` : ''}</div></div>
    <div class="qty">
      <button data-act="cart" data-k="${k}" data-d="-10" aria-label="Remove 10">−10</button>
      <input class="num-in qty-in" type="number" inputmode="numeric" min="0" step="5" data-input="cart-set" data-k="${k}" value="${q}" aria-label="${esc(d.name)} to order">
      <button data-act="cart" data-k="${k}" data-d="10" aria-label="Add 10">+10</button>
      <button class="wide" data-act="cart" data-k="${k}" data-d="50" aria-label="Add 50">+50</button>
    </div>
    <div class="stock-sub"><span>In stock <b class="num">${have}</b>${spoil ? ` <span class="neg">(${spoil} spoil tonight)</span>` : ''}</span><span>${target === 'today' ? 'Today' : 'Tomorrow'} ~<b class="num">${daily}</b>${cover !== null ? ` <span class="${cover < 1 ? 'neg' : cover < 1.3 ? '' : 'pos'}">· lasts ${cover < 0.1 ? 'under an hour' : cover < 1 ? `${Math.round(cover * 12)} of 12 hrs` : `${cover.toFixed(1)} days`}</span>` : ''}</span><span class="num">${money(price, true)}/${d.unit} ${trend > 1.06 ? '<span class="neg">▲</span>' : trend < 0.94 ? '<span class="pos">▼</span>' : ''}</span><span>Keeps ${d.shelf >= 999 ? 'forever' : plural(d.shelf + (d.space ? up(st, 'storage').shelfBonus ?? 0 : 0), 'day')}</span></div>
  </div>`;
}

function autoPanel(c: PanelCtx): string {
  const { s, st } = c;
  const can = canAutoReorder(st);
  let h = `<div class="ticket"><div class="row"><div class="grow"><div class="t-name">Nightly auto-reorder</div><div class="t-meta">${can ? 'Every night after close, orders tomorrow\'s stock so it arrives before opening.' : 'Needs Inventory Software (Upgrades, level 3) or a store manager.'}</div></div>
    <button class="toggle" data-act="auto-toggle" aria-pressed="${st.autoReorder && can}" aria-label="Auto-reorder" ${can ? '' : 'disabled'}></button></div>
    <div class="seg" role="group" style="margin:10px 0 0"><button data-act="reorder-mode" data-v="forecast" aria-pressed="${st.reorderMode === 'forecast'}">Order to forecast</button><button data-act="reorder-mode" data-v="par" aria-pressed="${st.reorderMode === 'par'}">Top up to par levels</button></div>
    <div class="t-meta" style="margin-top:6px">${st.reorderMode === 'forecast' ? `Uses tomorrow's weather, day of the week, events, your staff schedule and capacity, plus your ${orderBuffer(st)}% order buffer.` : 'Keeps each ingredient at the fixed level you set below.'}</div></div>`;
  if (st.reorderMode === 'forecast') return h;
  h += `<div class="section-label"><span>Par levels</span><button class="btn tiny" data-act="par-suggest">Use suggested</button></div>`;
  h += `<div class="ticket" style="padding:4px 0">`;
  for (const k of neededIngredients(s, st)) {
    const par = st.par[k] ?? 0;
    h += `<div class="stock-row"><span class="swatch" style="background:${ING[k].color}"></span><div class="grow"><div class="t-name" style="font-size:15px">${esc(ING[k].name)}</div></div>
      <div class="stepper"><button data-act="par" data-k="${k}" data-d="-10" aria-label="Lower">${icon('minus', 14)}</button><span class="val">${par}</span><button data-act="par" data-k="${k}" data-d="10" aria-label="Raise">${icon('plus', 14)}</button></div>
      <div class="stock-sub">In stock ${stockOf(st, k)} · suggested ${Math.ceil(estimateDailyNeed(s, st, k, 'tomorrow') * bufferMult(st) / 5) * 5}</div></div>`;
  }
  return h + '</div>';
}

function reviewCard(r: import('../core/types').Review, i: number, open: boolean): string {
  const d = r.detail;
  const KIND = { dine: 'Dine-in', takeout: 'Takeout', delivery: 'Delivery' } as const;
  const tone = r.stars >= 4 ? 'good' : r.stars >= 3 ? '' : 'bad';
  let body = '';
  if (open) {
    if (d) {
      const rows: string[] = [];
      rows.push(`<dt>Order</dt><dd>${d.items.length ? `${KIND[d.kind]}: ${esc(d.items.join(', '))}` : 'Never got to order'}</dd>`);
      if (d.paid > 0) rows.push(`<dt>Paid</dt><dd>${money(d.paid, true)}${d.priceRatio ? ` <span class="${d.priceRatio > 1.06 ? 'neg' : d.priceRatio < 0.92 ? 'pos' : ''}">(${d.priceRatio > 1.06 ? 'felt pricey' : d.priceRatio < 0.92 ? 'felt like a deal' : 'felt fair'})</span>` : ''}</dd>`);
      rows.push(`<dt>${r.topic === 'walkout' ? 'In line' : 'Wait'}</dt><dd>${d.wait} min${d.quote ? ` <span class="t-meta">(quoted ${d.quote})</span>` : ''}</dd>`);
      if (d.quality !== undefined) rows.push(`<dt>Food quality</dt><dd>${meter(d.quality, 100, d.quality >= 72 ? 'good' : d.quality >= 55 ? 'warn' : 'bad')} ${d.quality}</dd>`);
      if (d.clean !== undefined && d.kind !== 'delivery') rows.push(`<dt>Store cleanliness</dt><dd>${d.clean}%</dd>`);
      body += `<dl class="kv" style="margin-top:8px">${rows.join('')}</dl>`;
      if (d.factors?.length) body += `<div class="chips" style="margin-top:6px">${d.factors.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4).map(([l, v]) => `<span class="chip ${v > 0 ? 'good' : 'bad'}">${esc(l)} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>`;
    } else body += `<p class="t-meta" style="margin-top:6px">No visit details for this one.</p>`;
  }
  return `<button class="review-card ${tone} ${open ? 'open' : ''}" data-act="sub" data-key="rev" data-v="${open ? -1 : i}" aria-expanded="${open}">
    <div class="spread"><b>${esc(r.name)}</b>${stars(r.stars, 13)}</div>
    <q>${esc(r.text)}</q>
    <div class="t-meta">Day ${r.day}${d ? ` · ${KIND[d.kind]}` : ''}${d?.who ? ` · ${esc(d.who)}` : ''}${r.critic ? ' · <span class="chip ink">Critic</span>' : ''}${open ? '' : d ? ' · <span class="more-link">details</span>' : ''}</div>
    ${body}
  </button>`;
}

// =================================================================== MENU
export function menuPanel(c: PanelCtx): string {
  const { s, st } = c;
  const share = new Map(pizzaShare(s, st).map((x) => [x.id, x.share]));
  let h = `<p class="hint">Customers compare your price to what they think is <b>fair today</b>. That moves with the neighborhood, your ingredients and oven, your star rating, the weather (cold drinks on a hot day) and crowds in town. A little over fair costs a few orders; way over and people grumble in reviews. Not everyone agrees: some shrug at a markup, some walk. Delivery adds a ${money(DELIVERY_FEE, true)} fee.</p>`;
  // ---- specials
  const ideas = clearanceIdeas(s, st);
  h += `<div class="section-label"><span>Specials</span><span class="t-meta">${st.specials.length}/${MAX_SPECIALS}</span></div>`;
  if (st.specials.length || ideas.length) {
    h += `<div class="ticket">`;
    for (const sp of st.specials) {
      const live = activeSpecial(st, sp.id);
      h += `<div class="row special-row"><span class="chip ${sp.clearance ? 'warn' : 'gold'}">${sp.pct}% off</span><div class="grow"><b>${esc(ITEM[sp.id].name)}</b><div class="t-meta">${SPECIAL_WINDOWS[sp.window].name}${sp.clearance ? ' · clearance, ends tonight' : ''}${live ? ' · <span class="pos">on now</span>' : ''}</div></div><button class="btn tiny" data-act="special-end" data-id="${sp.id}">End</button></div>`;
    }
    for (const idea of ideas.slice(0, 2)) {
      if (st.specials.some((x) => x.id === idea.item)) continue;
      h += `<div class="row special-row"><span class="chip warn">${icon('alert', 12)} ${idea.surplus} spare</span><div class="grow"><b>${esc(ING[idea.ing].name)} expires tonight</b><div class="t-meta">About ${idea.surplus} more than today will use. A deal on ${esc(ITEM[idea.item].name)} moves it before it spoils.</div></div><button class="btn tiny gold" data-act="special-clear" data-id="${idea.item}">25% off today</button></div>`;
    }
    h += `</div>`;
  } else h += `<p class="t-meta" style="margin:0 2px 10px">No specials running. Put any pizza or side on special below: lunch only, dinner only, or all day.</p>`;
  const editing = c.sub.spEdit ?? '';
  const win = (c.sub.spWin ?? 'all') as SpecialWindow;
  const pct = Number(c.sub.spPct ?? 15);
  for (const m of MENU.filter((m) => s.unlocked.includes(m.id))) {
    const it = st.menu[m.id];
    const price = salePrice(st, m.id);
    const fair = fairPrice(s, st, m.id);
    const cost = itemFoodCost(s, st, m.id) + (m.type === 'drink' ? 0 : ingredientPrice(s, st, 'box') * 0.5);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const ratio = price / fair.price;
    const verdict = ratio < 0.88 ? ['Bargain', 'good'] : ratio <= 1.06 ? ['Fair', 'good'] : ratio <= 1.2 ? ['A bit pricey', 'warn'] : ratio <= 1.4 ? ['Pricey: some will grumble', 'bad'] : ['Rip-off', 'bad'];
    const sold = st.today.sold[m.id] ?? 0;
    const missing = (Object.entries(m.recipe) as [IngId, number][]).filter(([k, q]) => stockOf(st, k) < q).map(([k]) => ING[k].name);
    const sh = share.get(m.id);
    const sp = st.specials.find((x) => x.id === m.id);
    h += `<div class="ticket perf ${it.on ? '' : 'dim'}">
      <div class="row"><div class="grow"><div class="t-name">${esc(m.name)} <span class="chip">${m.type}</span>${sp ? ` <span class="chip gold">${sp.pct}% off · ${SPECIAL_WINDOWS[sp.window].short}</span>` : ''}</div><div class="t-desc">${esc(m.desc)}</div></div>
        <button class="toggle" data-act="menu-toggle" data-id="${m.id}" aria-pressed="${it.on}" aria-label="On the menu"></button></div>
      <div class="row wrap" style="margin-top:10px">
        <div class="stepper"><button data-act="price" data-id="${m.id}" data-d="-0.25" aria-label="Lower price 25 cents">${icon('minus', 14)}</button><span class="val-in">$<input class="num-in" type="number" inputmode="decimal" step="0.05" min="0.5" data-input="price-set" data-id="${m.id}" value="${it.price.toFixed(2)}" aria-label="${esc(m.name)} price"></span><button data-act="price" data-id="${m.id}" data-d="0.25" aria-label="Raise price 25 cents">${icon('plus', 14)}</button></div>
        <span class="chip ${verdict[1]}">${verdict[0]}</span>
      </div>
      <details class="fair"><summary>Fair today <b class="num">${money(fair.price, true)}</b>${price !== it.price ? ` · selling at ${money(price, true)}` : ''}</summary>
        <dl class="kv"><dt>Base price</dt><dd>${money(m.fair, true)}</dd>${fair.parts.map(([l, v]) => `<dt>${esc(l)}</dt><dd class="${v >= 1 ? 'pos' : 'neg'}">${v >= 1 ? '+' : '−'}${Math.abs(Math.round((v - 1) * 100))}%</dd>`).join('')}</dl></details>
      <dl class="kv" style="margin-top:8px"><dt>Food cost</dt><dd>${money(cost, true)}</dd><dt>Margin</dt><dd class="${margin < 55 ? 'neg' : ''}">${margin.toFixed(0)}%</dd>${sh !== undefined && it.on ? `<dt>Share of pizza orders</dt><dd>${Math.round(sh * 100)}%</dd>` : ''}<dt>Sold today</dt><dd>${sold}</dd></dl>
      ${m.type !== 'drink' && it.on ? (editing === m.id ? `<div class="special-edit">
          <div class="seg" role="group" aria-label="When">${(Object.keys(SPECIAL_WINDOWS) as SpecialWindow[]).map((w) => `<button data-act="sub" data-key="spWin" data-v="${w}" aria-pressed="${win === w}">${SPECIAL_WINDOWS[w].short}</button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Discount">${SPECIAL_PCTS.map((p) => `<button data-act="sub" data-key="spPct" data-v="${p}" aria-pressed="${pct === p}">${p}% off</button>`).join('')}</div>
          <div class="t-meta">${money(it.price * (1 - pct / 100), true)} during ${SPECIAL_WINDOWS[win].name.toLowerCase()}. Ordered about ${Math.round((specialAppeal(pct) - 1) * 100)}% more often.</div>
          <div class="btns"><button class="btn tiny gold" data-act="special-add" data-id="${m.id}" data-w="${win}" data-p="${pct}">${sp ? 'Update special' : 'Start special'}</button><button class="btn tiny" data-act="sub" data-key="spEdit" data-v="">Cancel</button></div></div>`
        : `<div class="btns"><button class="btn tiny ${sp ? 'gold' : ''}" data-act="sub" data-key="spEdit" data-v="${m.id}">${icon('star', 12)} ${sp ? 'Change special' : 'Put on special'}</button></div>`) : ''}
      ${missing.length && it.on ? `<div class="chips"><span class="chip bad">Out of ${esc(missing.join(', '))}: shown as sold out</span></div>` : ''}
    </div>`;
  }
  const locked = MENU.filter((m) => !s.unlocked.includes(m.id));
  if (locked.length) {
    h += `<div class="section-label">New recipes</div>`;
    for (const m of locked) {
      const ok = s.level >= m.unlockLevel;
      h += `<div class="ticket ${ok ? '' : 'dim'}"><div class="row"><div class="grow"><div class="t-name">${esc(m.name)}</div><div class="t-desc">${esc(m.desc)} Sells for about ${money(m.fair)}. Goes on the menu at every store, so order its toppings.</div>
        <div class="chips">${(Object.keys(m.recipe) as IngId[]).map((k) => `<span class="chip"><span class="swatch" style="background:${ING[k].color};width:8px;height:8px"></span>${esc(ING[k].name)}</span>`).join('')}</div></div></div>
        <div class="btns">${ok ? `<button class="btn buy small" data-act="unlock" data-id="${m.id}">Unlock <span class="num">${money(m.unlockCost)}</span></button>` : lockChip(m.unlockLevel)}</div></div>`;
    }
  }
  return h;
}

// =================================================================== UPGRADES
/** Delivery on/off, with a word on how it's going: it starts slow so nobody gets swamped. */
function deliveryToggle(s: GameState, st: Store): string {
  const on = !st.deliveryOff;
  const drivers = st.staff.filter((x) => x.role === 'driver').length;
  const ramp = st.deliverySince !== undefined ? s.day - st.deliverySince : 99;
  const note = !on ? 'Paused: no delivery orders come in. Walk-ins only until you turn it back on.'
    : !drivers ? 'On, but nobody can drive yet: hire a driver on the Hire tab and orders start coming in.'
    : ramp < 4 ? 'Starting slow: delivery orders build up over the first few days so the kitchen can find its feet.'
    : 'Delivery orders come in when a driver is on shift. Pause any time if the kitchen gets swamped.';
  return `<div class="row" style="margin-top:9px;gap:10px"><div class="grow t-meta">${esc(note)}</div><button class="btn small ${on ? 'buy' : ''}" data-act="delivery-toggle" aria-pressed="${on}">${on ? 'Delivery on' : 'Delivery paused'}</button></div>`;
}

export function upgradesPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sale = s.effects.find((e) => e.kind === 'upgradeSale');
  let h = sale ? `<div class="ticket"><span class="chip good">${icon('bolt', 12)} Supply sale: 20% off everything today</span></div>` : '';
  const groups = ['Kitchen', 'Front of house', 'Growth', 'Back office'] as const;
  for (const g of groups) {
    h += `<div class="section-label">${g}</div>`;
    for (const u of UPGRADES.filter((x) => x.group === g)) {
      const lv = st.upgrades[u.id];
      const cur = u.levels[lv];
      const next = u.levels[lv + 1];
      const cost = upgradeCost(s, st, u.id);
      const needs = u.needs && st.upgrades[u.needs] < 1;
      const focus = c.focusUpgrade === u.id;
      h += `<div class="ticket perf" id="up-${u.id}" style="${focus ? 'box-shadow:0 0 0 3px var(--crust),0 2px 6px rgba(70,40,15,0.12)' : ''}">
        <div class="row"><div class="grow"><div class="t-name">${esc(u.name)}</div><div class="t-meta">Now: ${esc(cur.name)} · ${esc(cur.desc)}</div></div>
        <span class="num t-meta" aria-label="level ${lv} of ${u.levels.length - 1}">${'■'.repeat(lv)}${'□'.repeat(u.levels.length - 1 - lv)}</span></div>
        ${next ? `<div class="row" style="margin-top:9px;align-items:flex-end"><div class="grow"><div style="font-weight:700">Next: ${esc(next.name)}</div><div class="t-desc">${esc(next.desc)}</div></div>
          ${needs ? `<span class="chip warn">Needs ${esc(UPG[u.needs!].name)}</span>` : s.level < next.req ? lockChip(next.req) : `<button class="btn buy small" data-act="upgrade" data-id="${u.id}" ${s.cash >= (cost ?? 0) ? '' : 'disabled'}>Buy <span class="num">${money(cost ?? 0)}</span></button>`}</div>` : '<div class="chips"><span class="chip good">Fully upgraded</span></div>'}
        ${u.id === 'delivery' && lv > 0 ? deliveryToggle(s, st) : ''}
      </div>`;
    }
  }
  return h;
}

// =================================================================== MARKETING
export function marketingPanel(c: PanelCtx): string {
  const { s, st } = c;
  const boost = marketingBoost(st);
  let h = `<div class="tiles"><div class="tile"><div class="hud-label">Marketing boost</div><div class="v">+${Math.round(boost * 100)}%</div><div class="d">on top of normal traffic</div></div>
    <div class="tile"><div class="hud-label">Customers right now</div><div class="v">${s.phase === 'open' ? walkInRate(s, st).toFixed(0) : '—'}</div><div class="d">walk-ins per hour</div></div></div>`;
  if (st.campaigns.length) {
    h += `<div class="section-label">Running here</div>`;
    for (const r of st.campaigns) {
      const d = CAMPAIGNS.find((x) => x.id === r.id)!;
      h += `<div class="ticket"><div class="spread"><span class="t-name">${esc(d.name)}</span><span class="chip good">${plural(r.daysLeft, 'day')} left</span></div><div class="t-desc">${esc(d.desc)}</div></div>`;
    }
  }
  const fx = s.effects.filter((e) => e.storeId === null || e.storeId === st.id);
  if (fx.length) {
    h += `<div class="section-label">In effect today</div><div class="ticket">${fx.map((e) => `<div class="spread"><span>${esc(e.label)}</span><span class="chip ${e.mult >= 1 && e.kind !== 'price' ? 'good' : 'bad'}">${e.kind === 'price' ? `${ING[e.ing!].name} ×${e.mult}` : e.kind === 'upgradeSale' ? '20% off upgrades' : (e.mult >= 1 ? '+' : '') + Math.round((e.mult - 1) * 100) + '% traffic'}</span></div>`).join('')}</div>`;
  }
  h += `<div class="section-label">Campaigns for ${esc(loc(st).name)}</div>`;
  for (const d of CAMPAIGNS) {
    const running = st.campaigns.some((x) => x.id === d.id);
    h += `<div class="ticket ${s.level < d.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name">${esc(d.name)}</div><div class="t-desc">${esc(d.desc)}</div></div>
      ${running ? '<span class="chip good">Running</span>' : s.level < d.req ? lockChip(d.req) : `<button class="btn buy small" data-act="campaign" data-id="${d.id}" ${s.cash >= d.cost ? '' : 'disabled'}>${d.cost ? 'Run <span class="num">' + money(d.cost) + '</span>' : 'Run (free)'}</button>`}</div></div>`;
  }
  h += `<div class="section-label">Brand-wide</div><div class="ticket ${s.level < LOYALTY.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name">Loyalty Card Program</div><div class="t-desc">+${Math.round(LOYALTY.boost * 100)}% customers at every store, forever. ${money(LOYALTY.dailyFee)}/day per store to run.</div></div>
    ${s.loyalty ? '<span class="chip good">Active</span>' : s.level < LOYALTY.req ? lockChip(LOYALTY.req) : `<button class="btn buy small" data-act="loyalty" ${s.cash >= LOYALTY.cost ? '' : 'disabled'}>Launch <span class="num">${money(LOYALTY.cost)}</span></button>`}</div></div>`;
  return h;
}

// =================================================================== FINANCE
export function financePanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.finance ?? 'books';
  let h = seg('finance', sub, [['books', 'Books'], ['service', 'Service'], ['reviews', 'Reviews'], ['bank', 'Bank']]);
  if (sub === 'service') return h + servicePanel(c);
  if (sub === 'reviews') {
    h += `<div class="tiles"><div class="tile"><div class="hud-label">Rating</div><div class="v rating-v">${pizzaRating(st.rating, 64)}</div><div class="d">${st.rating.toFixed(2)} out of 5</div></div>
      <div class="tile"><div class="hud-label">Cleanliness</div><div class="v">${Math.round(st.cleanliness)}%</div><div class="d">${meter(st.cleanliness)}</div></div></div>
      <p class="hint">Ratings move with every customer: quality, wait time, price, cleanliness and decor all count. Customers who give up and leave drag it down.</p>`;
    const open = Number(c.sub.rev ?? -1);
    h += `<p class="t-meta" style="margin:0 2px 8px">Tap a review to see what happened on that visit.</p>`;
    h += `<div class="reviews">${st.reviews.length ? st.reviews.slice(0, 25).map((r, i) => reviewCard(r, i, i === open)).join('') : '<div class="ticket"><p class="t-meta">No reviews yet. They roll in as you serve customers.</p></div>'}</div>`;
    return h;
  }
  if (sub === 'bank') {
    if (s.loan) {
      h += `<div class="ticket perf"><div class="t-name">Current loan</div><dl class="kv" style="margin-top:6px"><dt>Borrowed</dt><dd>${money(s.loan.principal)}</dd><dt>Left to repay</dt><dd>${money(s.loan.remaining, true)}</dd><dt>Daily payment</dt><dd>${money(s.loan.daily, true)}</dd><dt>Days left</dt><dd>${s.loan.daysLeft}</dd></dl>
        <div class="btns"><button class="btn buy small" data-act="repay" ${s.cash >= s.loan.remaining ? '' : 'disabled'}>Repay now <span class="num">${money(s.loan.remaining)}</span></button></div></div>`;
    }
    const rate = DIFFICULTY[s.difficulty].loanInterest;
    h += `<p class="hint">Loans cost ${Math.round(rate * 100)}% flat, repaid automatically over ${LOAN_DAYS} days. Three days in the red and the bank closes you down.</p>`;
    for (const l of LOANS) {
      const daily = (l.amount * (1 + rate)) / LOAN_DAYS;
      h += `<div class="ticket ${s.level < l.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name num" style="font-size:20px">${money(l.amount)}</div><div class="t-meta">${money(daily, true)}/day for ${LOAN_DAYS} days</div></div>
        ${s.level < l.req ? lockChip(l.req) : `<button class="btn small" data-act="loan" data-v="${l.amount}" ${s.loan ? 'disabled' : ''}>Borrow</button>`}</div></div>`;
    }
    return h;
  }
  // books: what came in, where it went, and what to do about it
  const all = (k: keyof Store['today']) => s.stores.reduce((a, x) => a + (x.today[k] as number), 0);
  const rev = all('revenue');
  const costs = all('supplies') + all('wages') + all('rent') + all('marketing') + all('other');
  const hist = companyHistory(s, 14);
  const y = hist[hist.length - 1];
  const week = s.stores.flatMap((x) => x.history.filter((d) => d.day > s.day - 8 && d.day < s.day + (s.phase === 'report' ? 1 : 0)));
  const sumW = (k: 'revenue' | 'supplies' | 'wages' | 'rent' | 'marketing' | 'other' | 'loan' | 'waste' | 'foodCost' | 'served' | 'lost') => week.reduce((a, d) => a + ((d[k] as number) ?? 0), 0);
  const days = new Set(week.map((d) => d.day)).size;
  h += `<div class="tiles">
    <div class="tile"><div class="hud-label">Sales today</div><div class="v">${compactMoney(rev)}</div><div class="d">${all('served')} served · ${all('lost')} lost</div></div>
    <div class="tile"><div class="hud-label">Spent today</div><div class="v">${compactMoney(costs)}</div><div class="d">wages and rent post at close</div></div>
    <div class="tile"><div class="hud-label">Yesterday</div><div class="v ${y && y.profit < 0 ? 'neg' : ''}">${y ? compactMoney(y.profit) : '—'}</div><div class="d">profit after all costs</div></div>
  </div>`;
  if (days) {
    const inc = sumW('revenue');
    const parts: [string, number, string][] = [
      ['Stock', sumW('supplies'), '#e0a12b'], ['Wages', sumW('wages'), '#2f6fd1'], ['Rent', sumW('rent'), '#8a6f5a'],
      ['Marketing', sumW('marketing'), '#b35fd1'], ['Other', sumW('other') + sumW('loan'), '#9a9a9a'],
    ];
    const spent = parts.reduce((a, p) => a + p[1], 0);
    const profit = inc - spent;
    const base = Math.max(inc, spent, 1);
    const bar = parts.filter((p) => p[1] > 0).map(([n, v, c]) => `<span style="width:${((v / base) * 100).toFixed(2)}%;background:${c}" title="${n}: ${money(v)}"></span>`).join('') + (profit > 0 ? `<span style="width:${((profit / base) * 100).toFixed(2)}%;background:#4f9a55" title="Profit: ${money(profit)}"></span>` : '');
    const served = sumW('served'), lost = sumW('lost');
    h += `<div class="section-label">Last ${plural(days, 'day')}</div><div class="ticket money-flow">
      <div class="spread"><div><div class="hud-label">Came in</div><div class="price">${money(inc)}</div><div class="t-meta">${served} customers · ${money(inc / Math.max(1, served), true)} a ticket</div></div>
        <div style="text-align:right"><div class="hud-label">Kept</div><div class="price ${profit < 0 ? 'neg' : 'pos'}">${profit < 0 ? '−' : ''}${money(Math.abs(profit))}</div><div class="t-meta">${money(profit / days)} a day</div></div></div>
      <div class="flow-bar">${bar}</div>
      <div class="flow-legend">${parts.filter((p) => p[1] > 0).map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} <b class="num">${money(v)}</b> <span class="t-meta">${inc ? Math.round((v / inc) * 100) : 0}%</span></span>`).join('')}${profit > 0 ? `<span><i style="background:#4f9a55"></i>Profit <b class="num">${money(profit)}</b> <span class="t-meta">${Math.round((profit / inc) * 100)}%</span></span>` : ''}</div>
    </div>`;
    // how to improve: the biggest few levers, worst first
    const tips: { w: number; t: string; act?: string; tab?: string }[] = [];
    const food = sumW('foodCost') || sumW('supplies');
    if (inc && food / inc > 0.33) tips.push({ w: food / inc - 0.3, t: `Food is ${Math.round((food / inc) * 100)}% of sales (aim under 32%). Nudge prices up on your costliest pizzas, or run a special on the cheap ones.`, tab: 'menu' });
    if (inc && sumW('wages') / inc > 0.32) tips.push({ w: sumW('wages') / inc - 0.3, t: `Wages are ${Math.round((sumW('wages') / inc) * 100)}% of sales (aim 25–30%). Suggest a schedule cuts hours on slow days.`, tab: 'staff' });
    if (served + lost && lost / (served + lost) > 0.08) tips.push({ w: lost / (served + lost), t: `${lost} customers left without buying (${Math.round((lost / (served + lost)) * 100)}%). Check Tomorrow's plan for the bottleneck: that's sales you already have.`, act: 'plan' });
    if (inc && sumW('waste') / inc > 0.03) tips.push({ w: sumW('waste') / inc, t: `${money(sumW('waste'))} of stock spoiled. Lower the order buffer in Stock, or let the truck order daily.`, tab: 'stock' });
    if (inc && sumW('rent') / inc > 0.18) tips.push({ w: sumW('rent') / inc - 0.15, t: `Rent takes ${Math.round((sumW('rent') / inc) * 100)}% of sales. More customers is the fix: marketing works best when the plan shows spare room.`, tab: 'marketing' });
    if (!tips.length) tips.push({ w: 0, t: profit > 0 ? 'Costs look healthy. Put the profit to work: upgrades that lift your bottleneck pay back fastest.' : 'Costs look normal, there just aren\'t enough customers yet. Marketing and a better rating bring more in.', tab: profit > 0 ? 'upgrades' : 'marketing' });
    tips.sort((a, b) => b.w - a.w);
    h += `<div class="section-label">How to make more</div>${tips.slice(0, 3).map((x) => `<div class="ticket improve"><div class="row">${icon('bolt', 16)}<div class="grow">${esc(x.t)}</div>${x.tab ? `<button class="btn tiny" data-act="tab" data-tab="${x.tab}">Go</button>` : x.act ? `<button class="btn tiny" data-act="${x.act}">Go</button>` : ''}</div></div>`).join('')}`;
  }
  h += `<div class="section-label">Daily profit, last ${hist.length || 14} days</div>`;
  h += hist.length ? profitChart(hist) : `<div class="ticket"><p class="t-meta">Finish your first day to see the chart.</p></div>`;
  if (y) {
    const store = st.history[st.history.length - 1];
    if (store) {
      h += `<details class="ticket fold-books"><summary><b>Yesterday at ${esc(loc(st).name)}, line by line</b></summary><dl class="kv" style="margin-top:6px">
        <dt>Sales</dt><dd class="pos">${money(store.revenue)}</dd>
        <dt>Supplies</dt><dd>${cost(store.supplies)}</dd>
        <dt>Wages</dt><dd>${cost(store.wages)}</dd>
        <dt>Rent</dt><dd>${cost(store.rent)}</dd>
        <dt>Marketing</dt><dd>${cost(store.marketing)}</dd>
        <dt>Other (training, fines, bonuses)</dt><dd>${cost(store.other)}</dd>
        ${store.loan ? `<dt>Loan</dt><dd>${cost(store.loan)}</dd>` : ''}
        <dt>Equipment (investment)</dt><dd>${cost(store.equipment)}</dd>
        <dt>Spoiled stock</dt><dd>${money(store.waste)}</dd>
      </dl>
      ${store.revenue > 0 ? `<div class="chips"><span class="chip ${store.foodCost / store.revenue > 0.33 ? 'warn' : 'good'}">Food cost ${Math.round((store.foodCost / store.revenue) * 100)}% of sales</span><span class="chip ${store.wages / store.revenue > 0.35 ? 'warn' : 'good'}">Labor ${Math.round((store.wages / store.revenue) * 100)}% of sales</span><span class="chip">Avg ticket ${money(store.revenue / Math.max(1, store.served), true)}</span></div>` : ''}
      </details>`;
    }
  }
  return h;
}

const cost = (v: number) => (v > 0.005 ? '−' + money(v) : '$0');

/** Yesterday's service: demand vs orders served per hour, where customers were lost, and timings. */
function servicePanel(c: PanelCtx): string {
  const { s, st } = c;
  const live = s.phase === 'open' || s.phase === 'closing';
  const d = live ? st.today : st.history[st.history.length - 1];
  let h = '';
  if (!d) return `<div class="ticket"><p class="t-meta">Finish your first day to see how service went.</p></div>`;
  const lineWait = d.lineWaitN ? d.lineWaitSum / d.lineWaitN : 0;
  const svc = d.serviceN ? d.serviceSum / d.serviceN : 0;
  h += `<div class="section-label">${live ? 'Today so far' : `Day ${d.day}`}</div><div class="tiles">
    <div class="tile"><div class="hud-label">Avg wait in line</div><div class="v">${lineWait.toFixed(1)}<span class="t-meta"> min</span></div><div class="d">before ordering</div></div>
    <div class="tile"><div class="hud-label">Order to food</div><div class="v">${svc.toFixed(0)}<span class="t-meta"> min</span></div><div class="d">incl. delivery drives</div></div>
    <div class="tile"><div class="hud-label">Served</div><div class="v">${d.served}</div><div class="d">${d.deliveries ?? 0} deliveries</div></div>
  </div>`;
  const lost = [
    ['Saw a full line and kept walking', d.turnedAway ?? 0, 'More till capacity, front-of-house staff or a kiosk.'],
    ['Gave up waiting or balked at the quoted wait', d.walkouts ?? 0, 'The kitchen or till is too slow at peak.'],
    ['Ran out of ingredients', d.soldOut, 'Fill to forecast each morning.'],
    ['Refunded after waiting too long', d.refunds, 'Kitchen, oven or runners overloaded.'],
    ['Pizzas remade', d.drops ?? 0, remakeWhy(d.remakes) + 'Training and rested staff help.'],
  ] as const;
  h += `<div class="section-label">Where customers were lost</div><div class="ticket">${lost.map(([label, n, fix]) => `<div class="spread review"><span>${label}${n ? `<div class="t-meta">${fix}</div>` : ''}</span><b class="num ${n ? 'neg' : ''}">${n}</b></div>`).join('')}</div>`;
  if (d.demandByHour?.length) h += `<div class="section-label">Customers by hour: wanted vs served</div>` + hourChart(d.demandByHour.slice(0, 12), d.servedByHour.slice(0, 12));
  // capacity plan for the day being planned
  const target = s.phase === 'report' ? 'tomorrow' : 'today';
  const plan = daySummary(s, st, target);
  h += `<div class="section-label">${target === 'today' ? "Today's" : "Tomorrow's"} forecast</div><div class="ticket"><dl class="kv"><dt>Expected customers</dt><dd>~${Math.round(plan.demand)}</dd><dt>You can serve</dt><dd>~${Math.round(plan.served)}</dd>${plan.limit ? `<dt>Limiting factor</dt><dd>${LIMIT_LABEL[plan.limit]}</dd>` : ''}</dl><div class="btns"><button class="btn small" data-act="plan">Open the hour-by-hour plan</button></div></div>`;
  return h;
}

/** Paired bars per hour (wanted vs served). */
export function hourChart(want: number[], got: number[], cap?: number[]): string {
  const W = 400, H = 150, L = 28, B = 20, T = 8;
  const max = Math.max(4, ...want, ...got, ...(cap ?? []));
  const slot = (W - L - 4) / 12;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  let bars = '';
  for (let i = 0; i < 12; i++) {
    const x = L + i * slot;
    const bw = slot * 0.36;
    bars += `<rect x="${(x + slot * 0.1).toFixed(1)}" y="${y(want[i] ?? 0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - y(want[i] ?? 0)).toFixed(1)}" rx="2" fill="#c9a271"/>`;
    bars += `<rect x="${(x + slot * 0.1 + bw + 1).toFixed(1)}" y="${y(got[i] ?? 0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - y(got[i] ?? 0)).toFixed(1)}" rx="2" fill="#2f7a3b"/>`;
    if (cap) bars += `<line x1="${(x + 2).toFixed(1)}" x2="${(x + slot - 2).toFixed(1)}" y1="${y(cap[i]).toFixed(1)}" y2="${y(cap[i]).toFixed(1)}" stroke="#c8352a" stroke-width="2"/>`;
    if (i % 2 === 0) bars += `<text class="ax" x="${(x + slot / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${clock(OPEN_MIN + i * 60).replace(':00', '')}</text>`;
  }
  let grid = '';
  const step = max > 40 ? 20 : max > 16 ? 10 : 5;
  for (let v = 0; v <= max; v += step) grid += `<line class="grid" x1="${L}" x2="${W - 4}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 4}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Customers per hour">${grid}${bars}</svg>
    <div class="chips" style="margin-top:4px"><span class="chip"><span class="swatch" style="background:#c9a271;width:9px;height:9px"></span>${cap ? 'Expected' : 'Wanted to order'}</span><span class="chip"><span class="swatch" style="background:#2f7a3b;width:9px;height:9px"></span>${cap ? 'Can serve' : 'Served'}</span>${cap ? '<span class="chip"><span class="swatch" style="background:#c8352a;width:9px;height:3px"></span>Capacity</span>' : ''}</div></div>`;
}

export interface DayPoint { day: number; revenue: number; costs: number; profit: number }
export function companyHistory(s: GameState, n: number): DayPoint[] {
  const days = new Map<number, DayPoint>();
  for (const st of s.stores) for (const d of st.history) {
    const p = days.get(d.day) ?? { day: d.day, revenue: 0, costs: 0, profit: 0 };
    const c = d.supplies + d.wages + d.rent + d.marketing + d.other + d.loan;
    p.revenue += d.revenue;
    p.costs += c;
    p.profit += d.revenue - c;
    days.set(d.day, p);
  }
  return [...days.values()].sort((a, b) => a.day - b.day).slice(-n);
}

function niceStep(range: number) {
  const raw = range / 4;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function profitChart(pts: DayPoint[]): string {
  const W = 400, H = 170, L = 44, R = 6, Tp = 8, B = 22;
  const max = Math.max(0, ...pts.map((p) => p.profit));
  const min = Math.min(0, ...pts.map((p) => p.profit));
  const step = niceStep(max - min || 100);
  const top = Math.ceil(max / step) * step || step;
  const bot = Math.floor(min / step) * step;
  const y = (v: number) => Tp + ((top - v) / (top - bot)) * (H - Tp - B);
  const slot = (W - L - R) / Math.max(pts.length, 7);
  const bw = Math.max(4, slot - 2);
  let g = '';
  for (let v = bot; v <= top + 1e-6; v += step) {
    g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="ax" x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${compactMoney(v).replace('$', '$')}</text>`;
  }
  let bars = '';
  pts.forEach((p, i) => {
    const x = L + i * slot + 1;
    const y0 = y(0), y1 = y(p.profit);
    const hgt = Math.max(1, Math.abs(y1 - y0));
    const pos = p.profit >= 0;
    const r = Math.min(4, hgt, bw / 2);
    const yTop = pos ? y1 : y0;
    // rounded data end, square at the baseline
    const d = pos
      ? `M${x},${y0} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 - r} V${y0} Z`;
    bars += `<path d="${d}" fill="${pos ? '#2f7a3b' : '#c8352a'}"/>`;
    bars += `<rect class="hit" x="${L + i * slot}" y="${Tp}" width="${slot}" height="${H - Tp - B}" fill="transparent" data-i="${i}"/>`;
    if (i === 0 || i === pts.length - 1 || pts.length <= 7 || i % 3 === 0) bars += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">D${p.day}</text>`;
  });
  const data = esc(JSON.stringify(pts.map((p) => [p.day, Math.round(p.revenue), Math.round(p.costs), Math.round(p.profit)])));
  return `<div class="chart" data-chart="${data}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily profit bar chart">${g}${bars}</svg>
    <details class="more"><summary>Show as table</summary><div class="table-wrap"><table class="chart-table"><thead><tr><th>Day</th><th>Sales</th><th>Costs</th><th>Profit</th></tr></thead><tbody>
    ${pts.slice().reverse().map((p) => `<tr><td>Day ${p.day}</td><td>${money(p.revenue)}</td><td>${money(p.costs)}</td><td class="${p.profit < 0 ? 'neg' : 'pos'}">${money(p.profit)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}

// =================================================================== EMPIRE
export function empirePanel(c: PanelCtx): string {
  const { s, st } = c;
  let h = `<div class="section-label">Your stores</div>`;
  for (const x of s.stores) {
    const L = LOC[x.locationId];
    const here = x === st;
    h += `<div class="ticket perf"><div class="row"><div class="grow"><div class="t-name">${esc(L.name)} ${here ? '<span class="chip ink">Viewing</span>' : ''}</div><div class="t-meta">${esc(L.district)} · rent ${money(L.rent)}/day</div></div>${pizzaRating(x.rating, 48)}</div>
      <dl class="kv" style="margin-top:8px"><dt>Sales today</dt><dd>${money(x.today.revenue)}</dd><dt>Served / lost</dt><dd>${x.today.served} / ${x.today.lost}</dd><dt>Staff</dt><dd>${x.staff.length} (${activeStaff(x).length} on shift)</dd><dt>Line right now</dt><dd>${x.customers.filter((q) => q.state === 'queue').length}</dd></dl>
      ${here ? '' : `<div class="btns"><button class="btn small" data-act="goto-store" data-id="${x.id}">${icon('camera', 14)} Go to store</button></div>`}</div>`;
  }
  const avail = LOCATIONS.filter((L) => !s.stores.some((x) => x.locationId === L.id));
  if (avail.length) {
    h += `<div class="section-label">Locations for sale</div>`;
    for (const L of avail) {
      const ok = s.level >= L.reqLevel;
      const sens = L.priceSens >= 1.3 ? 'very price sensitive' : L.priceSens >= 0.9 ? 'price aware' : L.priceSens >= 0.5 ? 'happy to pay more' : 'price is no object';
      h += `<div class="ticket ${ok ? '' : 'dim'}"><div class="row"><div class="grow"><div class="t-name">${esc(L.name)}</div><div class="t-meta">${esc(L.district)}</div></div><div class="price">${money(L.cost)}</div></div>
        <div class="t-desc">${esc(L.blurb)}</div>
        <div class="chips"><span class="chip">${Math.round((L.traffic / 9) * 100)}% of Maple St traffic</span><span class="chip">${sens}</span><span class="chip">${L.deliveryShare ? Math.round(L.deliveryShare * 100) + '% delivery demand' : 'no delivery'}</span><span class="chip">rent ${money(L.rent)}/day</span></div>
        <div class="btns">${ok ? `<button class="btn buy small" data-act="buy-location" data-id="${L.id}" ${s.cash >= L.cost ? '' : 'disabled'}>Buy location</button>` : lockChip(L.reqLevel)}</div></div>`;
    }
  }
  h += `<div class="section-label">Activity</div><div class="ticket">${s.news.slice(0, 18).map((n) => `<div class="review"><span class="t-meta">D${n.day} ${n.minute >= 600 ? clock(n.minute) : ''}</span> <span class="${n.tone === 'bad' ? 'neg' : n.tone === 'good' ? 'pos' : ''}">${esc(n.text)}</span></div>`).join('') || '<p class="t-meta">Nothing yet.</p>'}</div>`;
  return h;
}

// =================================================================== GOALS
export function goalsPanel(c: PanelCtx): string {
  const { s } = c;
  const cur = xpForLevel(s.level), next = xpForLevel(s.level + 1);
  let h = `<div class="ticket perf"><div class="spread"><span class="t-name">Level ${s.level}</span><span class="num t-meta">${Math.floor(s.xp - cur)} / ${next - cur} XP</span></div>
    <div style="margin-top:6px">${meter(s.xp - cur, next - cur, 'gold').replace('class="meter', 'class="meter wide')}</div>
    <div class="t-meta" style="margin-top:6px">Every satisfied customer earns XP. Next level unlocks: ${esc(unlocksAt(s.level + 1).join(', ') || 'more prestige')}.</div></div>`;
  h += `<div class="section-label"><span>Goals</span><span class="t-meta">${s.goalsDone.length} / ${GOALS.length} done</span></div>`;
  for (const g of activeGoals(s, 3)) {
    const p = g.progress(s);
    const pct = Math.min(1, p.cur / p.target);
    h += `<div class="ticket"><div class="row"><div class="grow"><div class="t-name">${esc(g.title)}</div><div class="t-desc">${esc(g.hint)}</div></div><span class="chip good">+${money(g.reward)}</span></div>
      <div class="row" style="margin-top:8px"><div class="grow">${meter(pct, 1, 'gold').replace('class="meter', 'class="meter wide')}</div><span class="num t-meta">${p.target === 1 ? (pct >= 1 ? 'Done' : 'Not yet') : `${typeof p.cur === 'number' && p.cur % 1 ? p.cur.toFixed(1) : Math.floor(p.cur).toLocaleString()} / ${p.target.toLocaleString()}`}</span></div></div>`;
  }
  if (!activeGoals(s, 1).length) h += `<div class="ticket"><p class="t-name">Every goal complete. You are a pizza legend.</p></div>`;
  // the Wall of Fame: Buzz and the features each store has earned
  for (const st of s.stores) {
    const nx = nextAccolade(st);
    const buzz = Math.floor(st.buzz ?? 0);
    const fame = st.fame ?? [];
    h += `<div class="section-label"><span>Wall of Fame${s.stores.length > 1 ? ` · ${esc(loc(st).name)}` : ''}</span><span class="t-meta">${buzz} Buzz</span></div>`;
    h += `<div class="ticket fame">${nx ? `<div class="row"><div class="grow"><div class="t-name" style="font-size:15px">Next: ${esc(nx.outlet(st))}</div><div class="t-meta">Buzz builds from great days, happy customers, good inspections and how you handle surprise visitors.${st.rating < nx.minRating ? ` Needs a ${nx.minRating.toFixed(1)}+ rating too.` : ''}</div></div><span class="num t-meta">${buzz} / ${nx.at}</span></div><div style="margin-top:8px">${meter(Math.min(buzz, nx.at), nx.at, 'gold').replace('class="meter', 'class="meter wide')}</div>` : '<div class="t-name">Every feature earned. Famous!</div>'}
      ${fame.length ? `<div class="fame-list">${fame.map((f) => `<div class="fame-item">${icon('star', 16)}<div><b>${esc(f.outlet)}</b><div class="t-meta">${esc(f.headline)} · day ${f.day}</div></div></div>`).join('')}</div>${st.fameBonus ? `<div class="t-meta" style="margin-top:6px">All this attention adds +${Math.round(st.fameBonus * 100)}% foot traffic for good.</div>` : ''}` : ''}
      ${(st.buzzLog ?? []).length ? `<details class="buzz-log"><summary class="t-meta">Recent Buzz</summary>${(st.buzzLog ?? []).slice(0, 8).map((b) => `<div class="spread t-meta"><span>${esc(b.why)} · day ${b.day}</span><span class="pos">+${b.v}</span></div>`).join('')}</details>` : ''}
    </div>`;
  }
  h += `<div class="section-label">Career</div><div class="ticket"><dl class="kv">
    <dt>Days in business</dt><dd>${s.stats.daysCompleted}</dd>
    <dt>Customers served</dt><dd>${s.stats.served.toLocaleString()}</dd>
    <dt>Customers lost</dt><dd>${s.stats.lost.toLocaleString()}</dd>
    <dt>Lifetime sales</dt><dd>${money(s.stats.revenue)}</dd>
    <dt>Best day (sales)</dt><dd>${money(s.stats.bestDayRevenue)}</dd>
    <dt>Best day (profit)</dt><dd>${money(s.stats.bestDayProfit)}</dd>
    <dt>Deliveries</dt><dd>${s.stats.deliveries.toLocaleString()}</dd>
  </dl></div>`;
  return h;
}

export function renderPanel(tab: TabId, c: PanelCtx): string {
  switch (tab) {
    case 'staff': return staffPanel(c);
    case 'stock': return stockPanel(c);
    case 'menu': return menuPanel(c);
    case 'upgrades': return upgradesPanel(c);
    case 'marketing': return marketingPanel(c);
    case 'finance': return financePanel(c);
    case 'empire': return empirePanel(c);
    case 'goals': return goalsPanel(c);
  }
}

export function panelTitle(tab: TabId, s: GameState, st: Store): { title: string; sub: string } {
  const where = s.stores.length > 1 ? loc(st).name : '';
  switch (tab) {
    case 'staff': return { title: 'Staff', sub: where || 'Hire, train and keep your team happy' };
    case 'stock': return { title: 'Stock', sub: where || 'Keep the walk-in full' };
    case 'menu': return { title: 'Menu & Prices', sub: where || 'What you sell and for how much' };
    case 'upgrades': return { title: 'Upgrades', sub: where || 'Equipment and improvements' };
    case 'marketing': return { title: 'Marketing', sub: where || 'Bring more customers in' };
    case 'finance': return { title: 'Finance', sub: 'Books, reviews and the bank' };
    case 'empire': return { title: 'Empire', sub: `${plural(s.stores.length, 'store')}` };
    case 'goals': return { title: 'Goals', sub: `Level ${s.level}` };
  }
}

export { TRAITS, ITEM, type ItemId };

/** "3 dropped, 2 wrong toppings, 1 burnt. " for the finance breakdown. */
function remakeWhy(r: Partial<Record<'drop' | 'wrong' | 'burnt', number>> | undefined): string {
  if (!r) return '';
  const parts = [r.drop ? `${r.drop} dropped` : '', r.wrong ? `${r.wrong} wrong toppings` : '', r.burnt ? `${r.burnt} burnt` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') + '. ' : '';
}

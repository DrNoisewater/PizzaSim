// Day cycle: opening, closing, nightly bookkeeping, and random events.
import { ING, ITEM, type IngId } from '../data/catalog';
import { LOC, LOYALTY, OPEN_MIN, PREP_MIN, WEATHER, type WeatherId, ROLES, shiftHours, SHIFTS, DRIVER_ROAD_WAGE, WEEK_HOURS, OVERTIME_MULT } from '../data/world';
import type { DayReport, EventKind, GameState, PendingChoice, Store } from './types';
import { DIFFICULTY, dailyWages, emptyDay, loc, onMenu, stockOf, storageCap, storageUsed, up, activeStaff, orderingManager } from './state';
import { autoReorder, addStock, receiveDeliveries, spoil, neededIngredients, suggestOrder, placeSupplyOrder, fitToBudget } from './inventory';
import { nightlyStaff, rollCandidates, performance, marketWage, trainingCost, trainingCostFor } from './staff';
import { updateMarket } from './economy';
import { checkGoals } from './progression';
import { dayNeed, daySummary, LIMIT_FIX, LIMIT_LABEL } from './forecast';
import { emit, money, news, now, pickOne, rand, randInt, weighted, clamp } from './util';
import { placeOpeningStaff, spawnCustomer } from './sim';
import { finishInspection, startInspection } from './inspector';
import { criticArrives } from './critic';
import { coverCallOffs, managerFixTomorrow } from './manager';
import { planFunVisit, funArrives, funResolve, dailyBuzz } from './fun';
import { shortageAdvice, shortageFor } from './shortage';

export function openForBusiness(s: GameState): { ok: boolean; msg?: string } {
  if (s.phase !== 'prep') return { ok: false, msg: 'The store is already open.' };
  if (s.choice) return { ok: false, msg: 'Decide on the pending event first.' };
  s.phase = 'open';
  s.minute = OPEN_MIN;
  for (const st of s.stores) {
    if (!activeStaff(st).length) news(s, `${loc(st).name} has nobody working today!`, 'bad');
    placeOpeningStaff(s, st);
    // remember the raw model forecast so Inventory Software can learn how far off it was
    const need = dayNeed(s, st, 'today', OPEN_MIN, true);
    st.today.fcPred = (Object.entries(need) as [IngId, number][]).reduce((a, [k, q]) => a + (k === 'box' || k === 'soda' ? 0 : q), 0);
  }
  news(s, `Day ${s.day}: doors open.`, 'info', false);
  return { ok: true };
}

/** Close the books for the day and build the report. */
export function endDay(s: GameState) {
  const report: DayReport = { day: s.day, stores: [], cashStart: 0, cashEnd: 0, levelStart: s.level, notes: [], tomorrow: [] };
  let revenue = 0, profit = 0;
  for (const st of s.stores) {
    const ratingStart = st.history.length ? st.history[st.history.length - 1].ratingEnd : 3;
    if (st.inspector) finishInspection(s, st);
    // anything still in progress at hard close is refunded
    for (const o of st.orders) {
      if (o.state !== 'done') {
        s.cash -= o.total;
        st.today.revenue -= o.total;
        s.stats.revenue -= o.total;
        st.today.refunds++;
      }
    }
    st.orders = [];
    st.customers = [];
    st.deliveryQueue = [];
    st.kiosks = [];
    st.dirty = [];
    for (const x of st.staff) x.task = null;
    // costs: paid hours for everyone who came in (sick days and days off are unpaid), plus hours
    // for anyone called in outside their own shift. Drivers earn the road rate while out on a
    // delivery. Hours past 40 in the last seven days are paid time and a half.
    let wages = 0, extra = 0, ot = 0, roadSaved = 0;
    for (const x of st.staff) {
      const worked = x.status === 'active' && !x.offToday;
      let hours = worked ? shiftHours(x.shift) : 0;
      const c = x.callIn;
      if (c && c.day === s.day) {
        const own = worked ? [SHIFTS[x.shift].start, SHIFTS[x.shift].end] : [0, 0];
        const mins = Math.max(0, c.until - c.from) - Math.max(0, Math.min(c.until, own[1]) - Math.max(c.from, own[0]));
        const h = Math.max(0, mins) / 60;
        extra += x.wage * h;
        hours += h;
      }
      let pay = worked ? x.wage * shiftHours(x.shift) : 0;
      if (x.role === 'driver' && x.wage > DRIVER_ROAD_WAGE) {
        const road = Math.min(hours, (x.roadMin ?? 0) / 60);
        roadSaved += (x.wage - DRIVER_ROAD_WAGE) * road;
        pay -= (x.wage - DRIVER_ROAD_WAGE) * road;
      }
      const log = (x.hoursLog ??= []);
      const before = log.slice(-6).reduce((a, b) => a + b, 0);
      const over = Math.max(0, Math.min(hours, before + hours - WEEK_HOURS));
      ot += over * x.wage * (OVERTIME_MULT - 1);
      log.push(Math.round(hours * 10) / 10);
      if (log.length > 7) log.splice(0, log.length - 7);
      wages += pay;
    }
    st.today.callInWages = extra;
    st.today.overtime = ot;
    st.today.roadSaved = roadSaved;
    wages += extra + ot;
    st.today.wages += wages;
    s.cash -= wages;
    const rent = Math.round(LOC[st.locationId].rent * DIFFICULTY[s.difficulty].rent) + (s.loyalty ? LOYALTY.dailyFee : 0);
    st.today.rent += rent;
    s.cash -= rent;
    st.today.waste = spoil(s, st);
    st.specials = st.specials.filter((x) => !x.clearance);
    for (const c of st.campaigns) c.daysLeft--;
    st.campaigns = st.campaigns.filter((c) => c.daysLeft > 0);
    // advice is based on today's plan, before staff records reset
    const advice = adviseDay(s, st);
    if (advice) (report.advice ??= []).push(advice);
    const { quit, notes } = nightlyStaff(s, st);
    report.notes.push(...notes);
    if (quit.length) report.notes.push(`${quit.map((q) => q.name).join(', ')} quit at ${loc(st).name}.`);
    // tomorrow is locked for the player: the manager patches any rush they're short for
    managerFixTomorrow(s, st);
    st.cleanliness = clamp(st.cleanliness + 35, 0, 100);
    st.ovenPenalty = 0;
    st.today.ratingEnd = st.rating;
    if (st.today.fcPred) {
      const used = (Object.entries(st.today.used) as [IngId, number][]).reduce((a, [k, q]) => a + (k === 'box' || k === 'soda' ? 0 : q), 0);
      st.fcLog.push({ day: s.day, pred: st.today.fcPred, used, limited: st.today.soldOut > 0 });
      if (st.fcLog.length > 20) st.fcLog.shift();
    }
    if (st.today.expressOrders) report.notes.push(`${loc(st).name}: ${st.today.expressOrders} express order${st.today.expressOrders > 1 ? 's' : ''} cost ${money(st.today.expressFees ?? 0)} in rush fees.${st.expressStreak > 1 ? ` That's ${st.expressStreak} days running, and the supplier's surcharge keeps climbing. Raise your order buffer instead.` : ' A bigger morning truck is cheaper.'}`);
    if (st.lastExpressDay < s.day) st.expressStreak = 0;
    const auto = autoReorder(s, st);
    if (auto > 0) report.notes.push(`Auto-reorder at ${loc(st).name}: ${money(auto)} of supplies arriving tomorrow.`);
    report.stores.push({ storeId: st.id, stats: { ...st.today, sold: { ...st.today.sold } }, ratingStart });
    revenue += st.today.revenue;
    profit += st.today.revenue - (st.today.supplies + st.today.wages + st.today.rent + st.today.marketing + st.today.other + st.today.loan);
  }
  // loan
  if (s.loan) {
    const pay = Math.min(s.loan.daily, s.loan.remaining);
    s.cash -= pay;
    s.loan.remaining -= pay;
    s.loan.daysLeft--;
    s.stores[0].today.loan += pay;
    report.stores[0].stats.loan += pay;
    profit -= pay;
    if (s.loan.remaining <= 0.01) {
      s.loan = null;
      report.notes.push('Loan fully repaid.');
    }
  }
  if (revenue > s.stats.bestDayRevenue) s.stats.bestDayRevenue = revenue;
  if (profit > s.stats.bestDayProfit) s.stats.bestDayProfit = profit;
  s.stats.daysCompleted++;
  for (const st of s.stores) {
    dailyBuzz(s, st);
    st.history.push(st.today);
    if (st.history.length > 30) st.history.shift();
  }
  // nudge toward a loan before it's too late
  const fixed = s.stores.reduce((a, st) => a + dailyWages(st) + Math.round(LOC[st.locationId].rent * DIFFICULTY[s.difficulty].rent), 0);
  if (!s.loan && s.cash < fixed * 2 && s.cash > -fixed * 3) report.notes.push(`Cash is getting tight (${money(s.cash)} vs about ${money(fixed)} a day in wages and rent). If you need breathing room, you can take a loan: Money → Bank.`);
  // bankruptcy check
  if (s.cash < 0) {
    s.negativeDays++;
    report.notes.push(s.negativeDays >= 3 ? 'The bank has called in your debts.' : `You are ${money(-s.cash)} in the red. ${3 - s.negativeDays} more day${3 - s.negativeDays === 1 ? '' : 's'} like this and the bank shuts you down.`);
    if (s.negativeDays >= 3) s.gameOver = true;
  } else s.negativeDays = 0;
  // tomorrow
  rollTomorrow(s, report);
  report.cashEnd = s.cash;
  report.cashStart = s.dayStartCash;
  s.report = report;
  s.phase = 'report';
  checkGoals(s);
  emit({ type: 'dayEnd' });
}

const SHORTAGE_ING: IngId[] = ['cheese', 'dough', 'sauce', 'pepperoni', 'mushroom', 'ham', 'sausage', 'chicken'];

function rollWeather(s: GameState): WeatherId {
  const r = rand(s);
  return r < 0.4 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.92 ? 'rainy' : 'hot';
}

function rollTomorrow(s: GameState, report: DayReport) {
  // s.forecast already holds tomorrow's weather
  report.tomorrow.push(`Forecast: ${WEATHER[s.forecast].name}.`);
  if (s.forecast === 'rainy') report.tomorrow.push('Rain keeps walk-ins home but delivery orders jump.');
  if (s.forecast === 'hot') report.tomorrow.push('Heatwave: expect to sell a lot of drinks.');
  const dow = s.day % 7;
  if (dow === 4 || dow === 5) report.tomorrow.push('Weekend crowds are coming.');
  for (const u of s.upcoming) {
    const inDays = u.day - s.day;
    const sh = u.ing ? shortageFor(s, u.ing) : null;
    if (sh) report.tomorrow.push(shortageAdvice(s, sh));
    else if (inDays === 1) report.tomorrow.push(`${u.label} starts tomorrow.`);
    else if (inDays >= 2) report.tomorrow.push(`${u.label} starts in ${inDays} days (day ${u.day}).`);
  }
  s.tomorrowEvent = null;
  // Logan Taylor turns up unannounced, rarely
  s.loganNext = s.day >= 3 && s.day - (s.loganLast ?? -99) >= 6 && rand(s) < 0.2 ? pickOne(s, s.stores).id : null;
  // the critic is rarer: once he's been, he stays away a good while
  s.criticNext = !s.loganNext && s.day >= 5 && s.day - (s.criticLast ?? -99) >= 10 && rand(s) < 0.13 ? pickOne(s, s.stores).id : null;
  const bad = DIFFICULTY[s.difficulty].badEvents;
  if (s.day >= 2 && rand(s) < 0.6) {
    const totalStaff = s.stores.reduce((n, st) => n + st.staff.length, 0);
    const best = Math.max(...s.stores.map((st) => st.rating));
    const shortageSoon = s.upcoming.some((u) => u.kind === 'shortage');
    const k = weighted<EventKind>(s, [
      { v: 'inspection', w: 0 },
      { v: 'critic', w: 0 },
      { v: 'biggame', w: 1.6 },
      { v: 'festival', w: 1.4 },
      { v: 'concert', w: s.day > 4 ? 1 : 0 },
      { v: 'shortage', w: shortageSoon ? 0 : 1.3 * bad },
      { v: 'oven', w: 1.0 * bad },
      { v: 'sick', w: totalStaff >= 3 ? 1.1 * bad : 0 },
      { v: 'rival', w: s.day > 5 ? 0.9 * bad : 0 },
      { v: 'wholesale', w: 1.2 },
      { v: 'raise', w: totalStaff >= 3 ? 0.9 * bad : 0 },
      { v: 'viral', w: best >= 4 ? 0.7 : 0 },
      { v: 'sale', w: s.level >= 2 ? 0.8 : 0 },
    ]);
    const st = pickOne(s, s.stores);
    const where = s.stores.length > 1 ? ` near ${loc(st).name}` : '';
    if (k === 'shortage') {
      // announced two days ahead so there's a morning to stock up
      const menuIngs = SHORTAGE_ING.filter((i) => s.stores.some((x) => neededIngredients(s, x).includes(i)));
      const ing = menuIngs.length ? pickOne(s, menuIngs) : 'cheese';
      const mult = Math.round((1.5 + rand(s) * 0.5) * 10) / 10;
      const label = `${ING[ing].name} shortage (+${Math.round((mult - 1) * 100)}% price for 3 days)`;
      s.upcoming.push({ kind: 'shortage', day: s.day + 2, storeId: null, ing, mult, days: 3, label });
      const sh = shortageFor(s, ing);
      report.tomorrow.push(`Supplier warning: ${sh ? shortageAdvice(s, sh) : label}`);
    } else if (k) {
      s.tomorrowEvent = k;
      s.tomorrowStore = st.id;
      if (k === 'biggame') report.tomorrow.push('Big game on TV tomorrow night: the dinner rush will be huge. Stock up and schedule extra dinner staff.');
      if (k === 'festival') report.tomorrow.push(`Street festival tomorrow${where}: extra foot traffic all day.`);
      if (k === 'concert') report.tomorrow.push(`Concert letting out tomorrow evening${where}: busy from 6 PM.`);
      if (k === 'sale') report.tomorrow.push('Restaurant supply sale tomorrow: 20% off all upgrades.');
    }
  }
}

/** One plain-language tip about the day's biggest problem at a store. */
/**
 * The end-of-day Tip. Without a manager it's a general nudge. A manager names the bottleneck
 * and the fix; from skill 3 they pinpoint the hour and the role to add, and say when they had
 * to jump on the line too often. A green manager sometimes leads with the second-biggest issue.
 */
function adviseDay(s: GameState, st: Store): string | null {
  const t = st.today;
  const name = s.stores.length > 1 ? `${loc(st).name}: ` : '';
  const line = t.turnedAway + t.walkouts;
  const total = t.served + line + t.refunds + t.soldOut;
  if (total < 5) return null;
  const m = st.staff.find((x) => x.role === 'manager' && x.status === 'active');
  const who = m ? `${m.name.split(' ')[0]}: ` : '';
  const sum = daySummary(s, st, 'today');
  const busiest = t.demandByHour.slice(0, 12).reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
  const hour = `${((OPEN_MIN / 60 + busiest + 11) % 12) + 1} ${OPEN_MIN / 60 + busiest >= 12 ? 'PM' : 'AM'}`;
  const issues: { v: number; basic: string; msg: string; sharp?: string }[] = [];
  if (line > 0) {
    const lim = sum.limit && sum.limit !== 'nobody' ? sum.limit : 'tills';
    issues.push({ v: line, basic: 'The line got long today. More hands at the counter would help.', msg: `${line} customers gave up on the line or saw it and kept walking. Bottleneck: ${LIMIT_LABEL[lim].toLowerCase()}. ${LIMIT_FIX[lim]}`, sharp: `Worst around ${hour}.` });
  }
  if (t.refunds > 0) issues.push({ v: t.refunds * 2.5, basic: 'Some orders took far too long. The kitchen needs help at the rush.', msg: `${t.refunds} orders were refunded after waiting too long. ${sum.limit === 'oven' ? 'The oven' : sum.limit === 'front' ? 'Running food to tables' : 'The kitchen'} couldn't keep up at peak. ${LIMIT_FIX[sum.limit === 'oven' ? 'oven' : sum.limit === 'front' ? 'front' : 'kitchen']}`, sharp: `It fell apart around ${hour}.` });
  if (t.soldOut > 0) issues.push({ v: t.soldOut * 2, basic: 'We ran out of ingredients. Order more in the morning.', msg: `${t.soldOut} customers left because we ran out of ingredients. Use Stock → Fill to forecast each morning, or let auto-reorder do it.` });
  if (t.drops >= 4) issues.push({ v: t.drops, basic: 'Lots of pizzas got remade. Training helps.', msg: `${t.drops} pizzas had to be remade${t.remakes?.burnt ? ` (${t.remakes.burnt} burnt while the oven was backed up)` : ''}${t.remakes?.wrong ? `${t.remakes?.burnt ? ',' : ''} ${t.remakes.wrong} with the wrong toppings` : ''}. Green or tired crew slip up more. Training and shorter shifts help.` });
  const jumps = t.mgrJumps ?? 0;
  if (m && jumps >= 6) {
    const role = sum.limit === 'kitchen' ? 'kitchen crew' : 'front of house';
    issues.push({ v: jumps * 0.8, basic: '', msg: `I had to jump on the line ${jumps} times today. We're short on ${role}.`, sharp: `Another ${role} person around ${hour} would let me run the shift.` });
  }
  if (!issues.length) {
    const avgSvc = t.serviceN ? t.serviceSum / t.serviceN : 0;
    return `${name}${who}${m ? `Smooth day. Average order-to-table time ${avgSvc.toFixed(0)} min.` : 'Good day. Keep it up.'}`;
  }
  issues.sort((a, b) => b.v - a.v);
  if (!m) return name + (issues.find((i) => i.basic)?.basic ?? issues[0].msg);
  // a green manager sometimes leads with the wrong thing
  const roll = ((s.day * 7919 + st.id * 104729) % 1000) / 1000;
  const pick = issues.length > 1 && roll < [0.4, 0.3, 0.2, 0.1, 0.05, 0.02][m.skill] ? issues[1] : issues[0];
  return name + who + pick.msg + (m.skill >= 3 && pick.sharp ? ' ' + pick.sharp : '');
}

/** Dismiss the report and roll into the next day's prep phase. */
export function beginNextDay(s: GameState) {
  if (s.phase !== 'report' || s.gameOver) return;
  s.report = null;
  s.dayStartCash = s.cash;
  s.day++;
  s.minute = PREP_MIN;
  s.phase = 'prep';
  s.weather = s.forecast;
  // the 7-day outlook rolls forward a day
  const out = s.outlook && s.outlook.length >= 7 ? s.outlook.slice(1) : [];
  while (out.length < 7) out.push(rollWeather(s));
  s.outlook = out;
  s.forecast = out[0];
  updateMarket(s);
  for (const e of s.effects) e.daysLeft--;
  s.effects = s.effects.filter((e) => e.daysLeft > 0);
  if (s.pendingEffects?.length) {
    s.effects.push(...s.pendingEffects);
    s.pendingEffects = [];
  }
  // announced events that start today
  for (const u of s.upcoming.filter((x) => x.day <= s.day)) {
    if (u.kind === 'shortage' && u.ing) {
      s.effects.push({ kind: 'price', storeId: null, mult: u.mult ?? 1.8, ing: u.ing, daysLeft: u.days ?? 3, label: u.label, since: s.day, total: u.days ?? 3 });
      const sh = shortageFor(s, u.ing);
      news(s, sh ? shortageAdvice(s, sh) : `${u.label} has started.`, 'bad');
    }
  }
  s.upcoming = s.upcoming.filter((x) => x.day > s.day);
  s.scheduled = [];
  for (const st of s.stores) {
    st.today = emptyDay(s.day, st.rating);
    receiveDeliveries(s, st, true);
    if (st.jobAd > 0) st.jobAd--;
    st.candidates = rollCandidates(s, st);
    // weekly schedule sets today's shifts and days off
    if (st.weekly) {
      const dow = (s.day - 1) % 7;
      for (const x of st.staff) {
        const v = st.schedule[x.id]?.[dow];
        if (!v) continue;
        if (v === 'off') x.offToday = true;
        else x.shift = v;
      }
    }
    // random sick days
    for (const x of st.staff) {
      if (x.status === 'active' && !x.offToday && !x.traits.includes('reliable') && rand(s) < 0.025) {
        x.status = 'sick';
        x.statusDays = 1;
      }
    }
  }
  if (s.tomorrowEvent) applyEvent(s, s.tomorrowEvent, s.tomorrowStore);
  s.tomorrowEvent = null;
  // the manager phones around to cover anyone out sick (random call-offs and the flu)
  for (const st of s.stores) coverCallOffs(s, st);
  if (s.loganNext && s.stores.some((x) => x.id === s.loganNext)) s.scheduled.push({ kind: 'logan', storeId: s.loganNext, at: s.day * 1440 + randInt(s, 11 * 60 + 30, 18 * 60 + 30), done: false });
  s.loganNext = null;
  if (s.criticNext && s.stores.some((x) => x.id === s.criticNext)) s.scheduled.push({ kind: 'critic', storeId: s.criticNext, at: s.day * 1440 + randInt(s, 12 * 60, 19 * 60), done: false });
  s.criticNext = null;
  planFunVisit(s);
  // a trained manager places the morning truck (arrives before opening)
  for (const st of s.stores) {
    st.warned = [];
    const m = orderingManager(st);
    if (!m || !st.mgrOrders.truck) continue;
    // short on cash: order what we can afford and keep a little back
    const lines = fitToBudget(s, st, suggestOrder(s, st, 'today'), Math.max(0, s.cash - 50));
    if (!Object.keys(lines).length) {
      st.truckDay = s.day;
      continue;
    }
    const r = placeSupplyOrder(s, st, lines, false);
    if (r.ok) news(s, `${m.name} placed the morning truck at ${loc(st).name}: ${money(r.cost)} of supplies.`, 'info');
    else news(s, `${m.name} couldn't place the morning truck at ${loc(st).name}: ${r.reason}`, 'bad');
  }
}

function applyEvent(s: GameState, kind: EventKind, storeId: number) {
  const st = s.stores.find((x) => x.id === storeId) ?? s.stores[0];
  const L = loc(st);
  const at = (a: number, b: number) => s.day * 1440 + randInt(s, a, b);
  switch (kind) {
    case 'inspection':
      s.scheduled.push({ kind, storeId: st.id, at: at(11 * 60 + 30, 19 * 60 + 30), done: false });
      break;
    case 'critic':
      s.scheduled.push({ kind, storeId: st.id, at: at(12 * 60, 20 * 60), done: false });
      break;
    case 'biggame':
      s.effects.push({ kind: 'dinner', storeId: null, mult: 1.7, daysLeft: 1, label: 'Big game night' });
      news(s, 'Big game tonight! Expect a monster dinner rush.', 'info');
      break;
    case 'festival':
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 1.4, daysLeft: 1, label: 'Street festival' });
      news(s, `Street festival outside ${L.name}: +40% foot traffic today.`, 'good');
      break;
    case 'cheese':
      s.effects.push({ kind: 'price', storeId: null, mult: 1.8, ing: 'cheese', daysLeft: 3, label: 'Mozzarella shortage', since: s.day, total: 3 });
      news(s, 'Mozzarella shortage: cheese costs 80% more for 3 days.', 'bad');
      break;
    case 'concert':
      s.effects.push({ kind: 'dinner', storeId: st.id, mult: 1.45, daysLeft: 1, label: 'Concert crowd' });
      news(s, `Concert tonight near ${L.name}: expect a busy evening.`, 'info');
      break;
    case 'viral':
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 1.6, daysLeft: 2, label: 'Viral video' });
      news(s, `A video of your pizza at ${L.name} went viral! +60% traffic for 2 days.`, 'good');
      break;
    case 'sale':
      s.effects.push({ kind: 'upgradeSale', storeId: null, mult: 0.8, daysLeft: 1, label: 'Supply sale' });
      news(s, 'Restaurant supply sale: all upgrades 20% off today.', 'good');
      break;
    case 'sick': {
      const pool = activeStaff(st).filter((x) => !x.traits.includes('reliable'));
      if (pool.length) {
        const x = pickOne(s, pool);
        x.status = 'sick';
        x.statusDays = 1;
        news(s, `${x.name} has the flu and is out today.`, 'bad');
      }
      break;
    }
    case 'oven': {
      const repair = 220 + 40 * s.level;
      setChoice(s, {
        kind, storeId: st.id, title: 'The oven is acting up',
        body: `${L.name}: the oven thermostat is flickering. Left alone, it will run at half capacity today.`,
        options: [
          { id: 'repair', label: `Call a technician (${money(repair)})`, detail: 'Fixed before opening.' },
          { id: 'patch', label: 'Patch it yourself ($60)', detail: '50% chance it holds.' },
          { id: 'ignore', label: 'Live with it', detail: 'Half oven capacity today.' },
        ],
        data: { repair },
      });
      break;
    }
    case 'rival':
      setChoice(s, {
        kind, storeId: st.id, title: 'A rival is undercutting you',
        body: `Pizza Pronto opened two blocks from ${L.name} and is running a 2-for-1 promo.`,
        options: [
          { id: 'coupon', label: 'Answer with a Coupon Day', detail: '+60% customers today, prices 20% off.' },
          { id: 'ignore', label: 'Ignore them', detail: '-15% traffic for 3 days.' },
        ],
      });
      break;
    case 'wholesale': {
      const qty = 60;
      const price = Math.round(ING.cheese.cost * qty * 0.55);
      setChoice(s, {
        kind, storeId: st.id, title: 'Wholesale clearance',
        body: `Bellini Foods is clearing ${qty} portions of mozzarella at 45% off for ${L.name}.`,
        options: [
          { id: 'buy', label: `Buy it (${money(price)})`, detail: 'Delivered right away, needs storage space.' },
          { id: 'pass', label: 'Pass', detail: 'No thanks.' },
        ],
        data: { qty, price },
      });
      break;
    }
    case 'raise': {
      const pool = st.staff.filter((x) => x.role !== 'manager');
      if (!pool.length) break;
      const x = pickOne(s, pool);
      const p = performance(st, x);
      const market = marketWage(x.role, x.skill);
      const review = p.grade === '—' ? 'Too new for a full review.' : `Performance review: grade ${p.grade}${p.perHour !== null ? `, ${p.perHour.toFixed(1)} tasks/hr${p.teamAvg ? ` (team ${p.teamAvg.toFixed(1)})` : ''}` : ''}${p.drops ? `, ${p.drops} remakes this week` : ''}. ${p.notes.join(' ')}`;
      setChoice(s, {
        kind, storeId: st.id, title: `${x.name} asks for a raise`,
        body: `${x.name} (${ROLES[x.role].name}, skill ${x.skill}) wants $1/hr more. They make ${money(x.wage, true)}/hr; market for their skill is ${money(market, true)}. ${review}`,
        options: [
          { id: 'accept', label: 'Give the full $1 raise', detail: 'Big morale boost.' },
          { id: 'half', label: 'Meet halfway: +50¢', detail: 'Small morale boost.' },
          ...(x.skill < 5 ? [{ id: 'train', label: `Pay for training instead (${money(trainingCostFor(x))})`, detail: 'Skill +1 tonight. They get the market rate for their new skill as it comes.' }] : []),
          { id: 'decline', label: 'Not right now', detail: p.raise ? 'They earned it: morale drops hard.' : 'Morale drops.' },
        ],
        data: { staffId: x.id, earned: p.raise ? 1 : 0 },
      });
      break;
    }
  }
}

function setChoice(s: GameState, c: PendingChoice) {
  s.choice = c;
}

export function resolveChoice(s: GameState, optionId: string): string {
  const c = s.choice;
  if (!c) return '';
  s.choice = null;
  const st = s.stores.find((x) => x.id === c.storeId) ?? s.stores[0];
  switch (c.kind) {
    case 'fun':
      return funResolve(s, st, String(c.data?.ev ?? ''), optionId);
    case 'oven':
      if (optionId === 'repair') {
        const cost = Number(c.data?.repair ?? 300);
        s.cash -= cost;
        st.today.other += cost;
        return 'The technician fixed the oven.';
      }
      if (optionId === 'patch') {
        s.cash -= 60;
        st.today.other += 60;
        if (rand(s) < 0.5) return 'Your patch job is holding. Nice.';
        st.ovenPenalty = Math.floor((up(st, 'oven').slots ?? 2) / 2);
        return 'The patch failed. Oven at half capacity today.';
      }
      st.ovenPenalty = Math.floor((up(st, 'oven').slots ?? 2) / 2);
      return 'Oven running at half capacity today.';
    case 'rival':
      if (optionId === 'coupon') {
        st.campaigns.push({ id: 'coupon', daysLeft: 1 });
        return 'Coupon Day is on. Prices are 20% off today.';
      }
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 0.85, daysLeft: 3, label: 'Rival promo' });
      return 'Pizza Pronto will pull some customers away for a few days.';
    case 'wholesale': {
      if (optionId !== 'buy') return 'You passed on the deal.';
      const qty = Number(c.data?.qty ?? 60), price = Number(c.data?.price ?? 0);
      const free = Math.floor((storageCap(st) - storageUsed(st)) / ING.cheese.space);
      const take = Math.min(qty, free);
      if (take <= 0) return 'No storage space for the cheese. Deal missed.';
      if (s.cash < price) return 'Not enough cash for the deal.';
      const cost = Math.round((price * take) / qty);
      s.cash -= cost;
      st.today.supplies += cost;
      addStock(s, st, 'cheese', take);
      return `Bought ${take} mozzarella for ${money(cost)}.`;
    }
    case 'raise': {
      const x = st.staff.find((q) => q.id === Number(c.data?.staffId));
      if (!x) return '';
      if (optionId === 'accept') {
        x.wage += 1;
        x.morale = clamp(x.morale + 20, 0, 100);
        return `${x.name} is thrilled with the raise.`;
      }
      if (optionId === 'half') {
        x.wage += 0.5;
        x.morale = clamp(x.morale + 8, 0, 100);
        return `${x.name} takes the 50¢ and says thanks.`;
      }
      if (optionId === 'train') {
        const cost = trainingCostFor(x);
        if (s.cash < cost) {
          x.morale = clamp(x.morale - 10, 0, 100);
          return `Not enough cash for the class. ${x.name} is disappointed.`;
        }
        s.cash -= cost;
        st.today.other += cost;
        x.course = true;
        x.morale = clamp(x.morale + 5, 0, 100);
        return `${x.name} signs up for tonight's class. Skill +1 tomorrow.`;
      }
      x.morale = clamp(x.morale - (Number(c.data?.earned) ? 25 : 15), 0, 100);
      return `${x.name} is disappointed.`;
    }
  }
  return '';
}

/** Timed events during the day (inspections, critics). */
export function runScheduled(s: GameState) {
  const t = now(s);
  for (const ev of s.scheduled) {
    if (ev.done || t < ev.at) continue;
    ev.done = true;
    const st = s.stores.find((x) => x.id === ev.storeId);
    if (!st || s.phase !== 'open') continue;
    if (ev.kind === 'inspection') inspect(s, st);
    if (ev.kind === 'logan' && !st.inspector) startInspection(s, st);
    if (ev.kind === 'critic') {
      spawnCustomer(s, st, true);
      criticArrives(s, st);
    }
    if (ev.kind === 'fun' && ev.data) funArrives(s, st, ev.data);
  }
}

function inspect(s: GameState, st: Store) {
  const c = st.cleanliness - new Set(st.dirty.map((x) => Math.floor(x / 2))).size * 4;
  const L = loc(st);
  if (c >= 85) {
    st.rating = clamp(st.rating + 0.1, 1, 5);
    news(s, `Health inspection at ${L.name}: Grade A! (+rating)`, 'good');
  } else if (c >= 60) {
    news(s, `Health inspection at ${L.name}: passed.`, 'info');
  } else {
    const fine = 250 + 50 * s.level;
    s.cash -= fine;
    st.today.other += fine;
    st.rating = clamp(st.rating - 0.15, 1, 5);
    news(s, `Health inspection at ${L.name} failed: ${money(fine)} fine. Hire a cleaner!`, 'bad');
  }
}

export { stockOf, onMenu, ITEM, up, storageCap, storageUsed, PREP_MIN, now };

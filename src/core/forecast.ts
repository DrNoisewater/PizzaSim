// Planning model: expected demand by hour, store capacity (and what limits it), and the
// ingredients a day will really use. Drives stock suggestions, auto-reorder, run-out
// warnings and the bottleneck readouts. Deterministic: no RNG.
import { kioskCount } from './layout';
import { ITEM, MENU, type IngId, type ItemId } from '../data/catalog';
import { CLOSE_MIN, OPEN_MIN, SHIFTS, WEATHER, type WeatherId } from '../data/world';
import type { Effect, GameState, Staff, Store } from './types';
import { activeStaff, loc, onMenu, stockOf, tills, up , spareBonus } from './state';
import { deliveryRate, pizzaWeights, walkInRate } from './economy';
import { WALK } from './layout';

export type Limit = 'tills' | 'front' | 'kitchen' | 'oven' | 'nobody';
export const LIMIT_LABEL: Record<Limit, string> = {
  tills: 'Till speed',
  front: 'Front-of-house staff',
  kitchen: 'Kitchen crew / make line',
  oven: 'Oven space',
  nobody: 'Nobody on shift',
};
export const LIMIT_FIX: Record<Limit, string> = {
  tills: 'Faster registers, more tills, or a second person at the counter.',
  front: 'More front-of-house staff, or overlapping lunch/dinner shifts.',
  kitchen: 'More kitchen crew, more make-line stations, or training.',
  oven: 'A bigger oven.',
  nobody: 'Schedule someone for these hours.',
};

/** Average pizzas per order. */
const PIZZAS_WALK = 0.78 + 0.18 * 2 + 0.04 * 3;
const PIZZAS_DEL = 0.55 + 0.35 * 2 + 0.1 * 3;
const KNOTS_P = 0.28;
const DINE_SHARE = 0.55;

export interface DayCtx {
  day: number;
  weather: WeatherId;
  effects: Effect[];
}

/** The day being planned: today during prep and open hours, tomorrow from the report on. */
export function planDay(s: GameState, which: 'today' | 'tomorrow'): DayCtx {
  if (which === 'today') return { day: s.day, weather: s.weather, effects: s.effects };
  const effects = [...s.effects.filter((e) => e.daysLeft > 1), ...(s.pendingEffects ?? [])];
  for (const u of s.upcoming) {
    if (u.day !== s.day + 1) continue;
    if (u.kind === 'shortage' && u.ing) effects.push({ kind: 'price', storeId: null, ing: u.ing, mult: u.mult ?? 1.8, daysLeft: u.days ?? 3, label: u.label });
  }
  return { day: s.day + 1, weather: s.forecast, effects };
}
/** Which day an order placed right now is for. */
export const orderTarget = (s: GameState): 'today' | 'tomorrow' => (s.phase === 'prep' ? 'today' : 'tomorrow');

export interface HourRow {
  /** Hour index, 0 = 10 AM. */
  h: number;
  walk: number;
  delivery: number;
  capacity: number;
  limit: Limit;
  /** Orders/hour each stage could handle. */
  parts: Record<Exclude<Limit, 'nobody'>, number>;
  driverCap: number;
  served: number;
}

function avgSpeed(xs: Staff[]) {
  if (!xs.length) return 0;
  let t = 0;
  for (const x of xs) {
    let v = (0.73 + 0.15 * x.skill) * (0.8 + 0.4 * (x.morale / 100)) * 0.95;
    if (x.traits.includes('speedy')) v *= 1.15;
    if (x.traits.includes('slacker')) v *= 0.85;
    if (x.traits.includes('perfectionist')) v *= 0.92;
    t += v;
  }
  return t / xs.length;
}

function shiftAt(st: Store, minute: number, role: Staff['role']) {
  return activeStaff(st, role).filter((x) => minute >= SHIFTS[x.shift].start && minute < SHIFTS[x.shift].end);
}

/** Average prep minutes and oven passes per walk-in order for the current menu mix. */
function mix(s: GameState, st: Store) {
  const w = pizzaWeights(s, st);
  let tw = 0, prep = 0, bake = 0;
  for (const o of w) tw += o.w;
  for (const o of w) {
    prep += (o.w / (tw || 1)) * ITEM[o.id].prep;
    bake += (o.w / (tw || 1)) * ITEM[o.id].bake;
  }
  const knots = onMenu(s, st, 'knots') ? KNOTS_P : 0;
  return { prep: prep || 2.5, bake: bake || 1, knots, weights: w, tw };
}

/** Orders per hour the store can turn out at a given minute, and the stage that limits it. */
export function capacityAt(s: GameState, st: Store, minute: number) {
  const front = shiftAt(st, minute, 'front');
  const cooks = shiftAt(st, minute, 'cook');
  const mgr = shiftAt(st, minute, 'manager');
  const m = mix(s, st);
  const fs = avgSpeed(front) || avgSpeed(mgr) || avgSpeed(cooks) * 0.6 || 1;
  const cs = avgSpeed(cooks) || 1;
  const reg = up(st, 'register');
  const orderMin = ((reg.orderTime ?? 1.6) * (1 - spareBonus(tills(st) - front.length - mgr.length))) / fs + 0.5;
  const people = front.length + mgr.length * 0.5 + (front.length ? 0 : cooks.length * 0.35);
  const tillN = Math.min(tills(st), Math.max(0, people));
  const kiosks = kioskCount(st);
  const tillsCap = (tillN * 60) / orderMin + (kiosks * 60) / 1.9;
  // front staff also run dine-in food and bus tables
  const runMin = (2 * 4.5) / WALK + 0.15;
  const busMin = 4 / WALK + 0.5;
  const frontMin = orderMin + DINE_SHARE * (runMin + busMin);
  const frontCap = people > 0 ? (people * 60) / frontMin + kiosks * 20 : 0;
  const stations = up(st, 'prep').stations ?? 1;
  const prepSpeed = up(st, 'prep').speed ?? 1;
  const kitchenHands = Math.min(stations, cooks.length + (cooks.length ? 0 : mgr.length * 0.5));
  const prepPerOrder = ((m.prep * PIZZAS_WALK + m.knots * 1.5) * (1 - 0.8 * spareBonus(stations - cooks.length))) / (cs * prepSpeed);
  const kitchenCap = kitchenHands > 0 ? (kitchenHands * 60) / prepPerOrder : 0;
  const slots = Math.max(1, (up(st, 'oven').slots ?? 2) - st.ovenPenalty);
  const bakeMin = up(st, 'oven').bakeTime ?? 7;
  const ovenPerOrder = (PIZZAS_WALK * m.bake + m.knots * 0.6) * bakeMin;
  const ovenCap = (slots * 60) / ovenPerOrder;
  const parts = { tills: tillsCap, front: frontCap, kitchen: kitchenCap, oven: ovenCap };
  let limit: Limit = 'tills';
  let cap = Infinity;
  for (const k of Object.keys(parts) as (keyof typeof parts)[]) {
    if (parts[k] < cap) {
      cap = parts[k];
      limit = k;
    }
  }
  if (!front.length && !cooks.length && !mgr.length) limit = 'nobody';
  // drivers: trips per hour times orders per trip
  const drivers = shiftAt(st, minute, 'driver');
  const vcap = up(st, 'delivery').vehicleCap ?? 0;
  const trip = (13 + 5 * Math.max(0, vcap - 1) * 0.5) * loc(st).deliveryDist * (up(st, 'delivery').vehicleSpeed ?? 1) / Math.max(0.6, avgSpeed(drivers) || 1) + 2;
  const driverCap = vcap > 0 ? (drivers.length * 60 * Math.max(1, vcap * 0.7)) / trip : 0;
  return { capacity: Math.max(0, cap), limit, parts, driverCap };
}

/** Expected demand and capacity for each opening hour of a day. */
export function dayPlan(s: GameState, st: Store, which: 'today' | 'tomorrow'): HourRow[] {
  return dayPlanCtx(s, st, planDay(s, which));
}
export function dayPlanCtx(s: GameState, st: Store, ctx: DayCtx): HourRow[] {
  const rows: HourRow[] = [];
  for (let h = 0; h < 12; h++) {
    const minute = OPEN_MIN + h * 60 + 30;
    const hasDriver = shiftAt(st, minute, 'driver').length > 0;
    const walk = walkInRate(s, st, { day: ctx.day, minute, weather: ctx.weather, effects: ctx.effects });
    const del = deliveryRate(s, st, hasDriver, { day: ctx.day, minute, weather: ctx.weather, effects: ctx.effects });
    const c = capacityAt(s, st, minute);
    const walkServed = Math.min(walk, c.capacity);
    const delServed = Math.min(del, c.driverCap, Math.max(0, c.capacity * 1.25 - walkServed));
    rows.push({ h, walk, delivery: del, capacity: c.capacity, limit: c.limit, parts: c.parts, driverCap: c.driverCap, served: walkServed + delServed });
  }
  return rows;
}

/** Average extra side/drink chance from upsellers at the till. */
function upsell(st: Store) {
  const takers = activeStaff(st).filter((x) => x.role === 'front' || x.role === 'manager');
  if (!takers.length) return 0;
  return (0.2 * takers.filter((x) => x.traits.includes('upseller')).length) / takers.length;
}

/** Dine-in customers the tables can seat per hour (the rest get boxes to go). */
export function seatsPerHour(st: Store) {
  const seats = up(st, 'dining').seats ?? 4;
  // walk to the table, wait for food, eat, leave, get bused
  return (seats * 60) / 48;
}

/**
 * Expected ingredient use per order (walk-in or delivery). Boxes are left out for walk-ins:
 * how many get boxed depends on how many fit at the tables (see boxesFor).
 */
export function perOrder(s: GameState, st: Store, kind: 'walk' | 'delivery', weather: WeatherId): Partial<Record<IngId, number>> {
  const m = mix(s, st);
  const up2 = kind === 'walk' ? upsell(st) : 0;
  const out: Partial<Record<IngId, number>> = {};
  const add = (k: IngId, q: number) => (out[k] = (out[k] ?? 0) + q);
  const pizzas = kind === 'walk' ? PIZZAS_WALK : PIZZAS_DEL;
  for (const o of m.weights) for (const [k, q] of Object.entries(ITEM[o.id].recipe) as [IngId, number][]) add(k, (o.w / (m.tw || 1)) * pizzas * q);
  const knots = m.knots ? Math.min(1, m.knots + up2) : 0;
  if (knots) for (const [k, q] of Object.entries(ITEM.knots.recipe) as [IngId, number][]) add(k, knots * q);
  if (onMenu(s, st, 'soda')) {
    const d = Math.min(1, (0.4 + up2) * WEATHER[weather].drinks * (loc(st).prefs.soda ?? 1));
    add('soda', d + d * d * 0.3);
  }
  if (kind === 'delivery') add('box', pizzas + knots);
  return out;
}
/** Boxes used by an hour's walk-in orders. */
function boxesFor(s: GameState, st: Store, walkOrders: number) {
  const m = mix(s, st);
  const dine = Math.min(walkOrders * DINE_SHARE, seatsPerHour(st));
  return (walkOrders - dine) * (PIZZAS_WALK + m.knots + upsell(st));
}

/** Walk-in orders placed per hour: limited by the till, not the kitchen. */
// Capacity estimates run conservative and staff often beat them at the rush, so stock planning
// allows 30% over the estimate rather than under-ordering (running out costs far more than leftovers).
const ordered = (r: HourRow) => Math.min(r.walk, Math.max(r.capacity, Math.min(r.parts.tills, r.parts.front)) * 1.3);

/**
 * Inventory Software learns how far off the model has been at this store (ratio of real use to
 * forecast on days that didn't sell out) and corrects for it. Smart Forecasting looks further back
 * and weights recent days more.
 */
export function learnFactor(st: Store): number {
  const lv = st.upgrades.software;
  if (lv < 1) return 1;
  const log = st.fcLog.filter((x) => !x.limited && x.pred > 20).slice(lv >= 2 ? -10 : -5);
  if (log.length < 2) return 1;
  let num = 0, den = 0;
  log.forEach((x, i) => {
    const w = lv >= 2 ? Math.pow(1.25, i) : 1;
    num += (x.used / x.pred) * w;
    den += w;
  });
  return Math.max(0.85, Math.min(1.25, num / den));
}

/** Units of each ingredient a whole day is expected to use. */
export function dayNeed(s: GameState, st: Store, which: 'today' | 'tomorrow', fromMinute = OPEN_MIN, raw = false): Partial<Record<IngId, number>> {
  const ctx = planDay(s, which);
  const rows = dayPlan(s, st, which);
  const pw = perOrder(s, st, 'walk', ctx.weather);
  const pd = perOrder(s, st, 'delivery', ctx.weather);
  const out: Partial<Record<IngId, number>> = {};
  for (const r of rows) {
    const start = OPEN_MIN + r.h * 60;
    const frac = Math.max(0, Math.min(1, (start + 60 - fromMinute) / 60));
    if (frac <= 0) continue;
    // stock goes on orders placed at the till, even ones the kitchen later can't finish in time
    const walkOrdered = ordered(r) * frac;
    const delOrdered = r.delivery * frac;
    for (const [k, q] of Object.entries(pw) as [IngId, number][]) out[k] = (out[k] ?? 0) + q * walkOrdered;
    for (const [k, q] of Object.entries(pd) as [IngId, number][]) out[k] = (out[k] ?? 0) + q * delOrdered;
    out.box = (out.box ?? 0) + boxesFor(s, st, ordered(r)) * frac;
  }
  const f = raw ? 1 : learnFactor(st);
  if (f !== 1) for (const k of Object.keys(out) as IngId[]) out[k]! *= f;
  return out;
}

/** When today's stock of an ingredient is expected to run out (minute), or null if it lasts. */
export function runsOutAt(s: GameState, st: Store, ing: IngId): number | null {
  if (s.phase === 'report') return null;
  const rows = dayPlan(s, st, 'today');
  const pw = perOrder(s, st, 'walk', s.weather)[ing] ?? 0;
  const pd = perOrder(s, st, 'delivery', s.weather)[ing] ?? 0;
  let left = stockOf(st, ing);
  for (const inc of st.incoming) if (inc.ing === ing && inc.at >= 0) left += inc.qty;
  const now = s.phase === 'prep' ? OPEN_MIN : s.minute;
  for (const r of rows) {
    const start = OPEN_MIN + r.h * 60;
    if (start + 60 <= now) continue;
    const t0 = Math.max(start, now);
    const frac = (start + 60 - t0) / 60;
    const walk = ordered(r);
    const use = (walk * pw + r.delivery * pd + (ing === 'box' ? boxesFor(s, st, walk) : 0)) * frac;
    if (use > left) return t0 + (left / Math.max(0.001, use)) * 60 * frac;
    left -= use;
  }
  return left < 0 ? CLOSE_MIN : null;
}

/** Summary of the planned day for the UI. */
export function daySummary(s: GameState, st: Store, which: 'today' | 'tomorrow') {
  const rows = dayPlan(s, st, which);
  let demand = 0, served = 0;
  const limits = new Map<Limit, number>();
  for (const r of rows) {
    const d = r.walk + r.delivery;
    demand += d;
    served += r.served;
    const short = Math.max(0, r.walk - r.capacity);
    if (short > 0.5) limits.set(r.limit, (limits.get(r.limit) ?? 0) + short);
  }
  const top = [...limits.entries()].sort((a, b) => b[1] - a[1])[0];
  return { rows, demand, served, missed: Math.max(0, demand - served), limit: top ? top[0] : null, limitMissed: top ? top[1] : 0 };
}

export const pizzaShare = (s: GameState, st: Store): { id: ItemId; share: number }[] => {
  const w = pizzaWeights(s, st);
  let t = 0;
  for (const o of w) t += o.w;
  return w.map((o) => ({ id: o.id, share: o.w / (t || 1) }));
};
export { MENU };

// ------------------------------------------------------------------ staffing

/** Run fn with a weekday's schedule applied (shifts and days off), then put everything back. */
export function withSchedule<T>(st: Store, dow: number, fn: () => T): T {
  if (!st.weekly) return fn();
  const saved = st.staff.map((x) => [x.shift, x.offToday] as const);
  for (const x of st.staff) {
    const v = st.schedule[x.id]?.[dow];
    if (!v) continue;
    if (v === 'off') x.offToday = true;
    else {
      x.shift = v;
      x.offToday = false;
    }
  }
  try {
    return fn();
  } finally {
    st.staff.forEach((x, i) => ([x.shift, x.offToday] = saved[i]));
  }
}

export interface Gap {
  window: 'lunch' | 'dinner';
  role: 'cook' | 'front';
  /** People to add to cover the busiest hour. */
  extra: number;
  /** Busiest short hour (index, 0 = 10 AM). */
  peak: number;
  /** Customers per hour that won't get served at the peak. */
  short: number;
  /** More people wouldn't help: the make line, tills or oven are the limit. */
  equip?: boolean;
}

/** What to buy when more people wouldn't help. */
export const equipFix = (g: Gap) => (g.role === 'cook' ? 'the make line is full, so a bigger Make Line helps more than another cook' : 'the tills are maxed out, so faster registers help more than another person');

const ROLE_FOR: Partial<Record<Limit, 'cook' | 'front'>> = { kitchen: 'cook', front: 'front', tills: 'front', nobody: 'front' };

/**
 * Where the schedule leaves customers unserved, which role fixes it and how many people it takes.
 * Tries adding average (skill 2) people to that half of the day until the busiest hour is covered.
 */
export function staffingGaps(s: GameState, st: Store, ctx: DayCtx): { rows: HourRow[]; gaps: Gap[]; idle: { window: 'lunch' | 'dinner'; role: 'cook' | 'front' }[] } {
  const rows = dayPlanCtx(s, st, ctx);
  const gaps: Gap[] = [];
  const idle: { window: 'lunch' | 'dinner'; role: 'cook' | 'front' }[] = [];
  for (const window of ['lunch', 'dinner'] as const) {
    const hours = rows.filter((r) => (window === 'lunch' ? r.h < 6 : r.h >= 6));
    const short = hours.filter((r) => r.walk > r.capacity + 0.75 && ROLE_FOR[r.limit]);
    if (short.length) {
      const peak = short.reduce((a, r) => (r.walk - r.capacity > a.walk - a.capacity ? r : a));
      const role = ROLE_FOR[peak.limit]!;
      const fake: Staff[] = [];
      // test with someone like the people they'd actually hire: the team's own average skill
      const mates = st.staff.filter((x) => x.role === role && x.id > 0);
      const avgSkill = mates.length ? Math.max(1, Math.round(mates.reduce((a, x) => a + x.skill, 0) / mates.length)) : 1;
      let extra = 0;
      let last = -1;
      let equip = false;
      for (; extra < 4; extra++) {
        const c = capacityAt(s, st, OPEN_MIN + peak.h * 60 + 30);
        if (c.capacity >= peak.walk - 0.75 || (ROLE_FOR[c.limit] ?? role) !== role) break;
        // another person didn't add anything: stations or tills are full
        if (last >= 0 && c.capacity < last + 0.5) {
          // the last person added didn't help
          extra--;
          equip = extra === 0;
          break;
        }
        last = c.capacity;
        const f = { id: -1 - extra, role, skill: avgSkill, morale: 70, energy: 100, traits: [], status: 'active', offToday: false, shift: window } as unknown as Staff;
        fake.push(f);
        st.staff.push(f);
      }
      for (const f of fake) st.staff.splice(st.staff.indexOf(f), 1);
      if (equip) gaps.push({ window, role, extra: 0, peak: peak.h, short: peak.walk - peak.capacity, equip: true });
      else if (extra > 0 || role) gaps.push({ window, role, extra: Math.max(1, extra), peak: peak.h, short: peak.walk - peak.capacity });
    }
    // lots of slack: more people than the busiest hour needs
    for (const role of ['front', 'cook'] as const) {
      const team = activeStaff(st, role).filter((x) => SHIFTS[x.shift].start < (window === 'lunch' ? 16 * 60 : CLOSE_MIN) && SHIFTS[x.shift].end > (window === 'lunch' ? OPEN_MIN : 16 * 60));
      if (team.length < 2 || short.length) continue;
      const peakWalk = Math.max(...hours.map((r) => r.walk));
      const cap = Math.min(...hours.map((r) => (role === 'front' ? Math.min(r.parts.front, r.parts.tills) : r.parts.kitchen)));
      if (cap > peakWalk * (1 + 1.1 / team.length) + 4) idle.push({ window, role });
    }
  }
  return { rows, gaps, idle };
}

/** Planning context for any upcoming day (weather from the outlook when we have it). */
export function ctxForDay(s: GameState, day: number): DayCtx {
  if (day === s.day) return planDay(s, 'today');
  if (day === s.day + 1) return planDay(s, 'tomorrow');
  const w = s.outlook?.[day - s.day - 1] ?? 'cloudy';
  return { day, weather: w, effects: s.effects.filter((e) => e.daysLeft > day - s.day) };
}

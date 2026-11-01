// Staffing by the hour: how many cooks, front-of-house staff and drivers each opening hour
// needs for the forecast, and a schedule builder that covers that need with as few paid hours
// as it can. It prefers full 8-hour days and gives people up to 40 hours a week before
// spreading hours thinner. The builder is deterministic: the same week gives the same schedule.
import { OPEN_MIN, SHIFTS, MAX_STAFF, type ShiftId, ROLES } from '../data/world';
import type { GameState, Staff, Store } from './types';
import { up, tills } from './state';
import { walkInRate, deliveryRate } from './economy';
import { capacityAt, ctxForDay, withSchedule, type DayCtx } from './forecast';

export type NeedRole = 'cook' | 'front' | 'driver';
export interface HourNeed {
  h: number;
  walk: number;
  delivery: number;
  need: Record<NeedRole, number>;
  /** More people in this role wouldn't help: the make line, tills or oven are full. */
  equip: Partial<Record<'cook' | 'front', boolean>>;
}

/** Room for a busier-than-forecast hour. */
const HEADROOM = 1.25;
/** Weekly hours: the aim, and the most anyone gets if the store really needs them. */
export const FULL_TIME = 40;
export const MAX_HOURS = 48;

const fake = (role: Staff['role'], n: number, skill: number, base: number): Staff[] =>
  Array.from({ length: n }, (_, i) => ({ id: -(base + i + 1), role, skill, morale: 70, energy: 100, traits: [], status: 'active', offToday: false, shift: 'full' } as unknown as Staff));

function teamSkill(st: Store, role: Staff['role']) {
  const xs = st.staff.filter((x) => x.role === role && x.id > 0);
  return xs.length ? Math.max(1, Math.round(xs.reduce((a, x) => a + x.skill, 0) / xs.length)) : 1;
}

/**
 * People needed per role for each opening hour of a day, for the forecast plus a little room.
 * Works out the smallest crew whose capacity covers the hour, adding a cook or a front-of-house
 * person to whichever stage is the limit. Always at least one of each while open.
 */
export function hourlyNeed(s: GameState, st: Store, ctx: DayCtx): HourNeed[] {
  const real = st.staff;
  const sc = teamSkill(st, 'cook'), sf = teamSkill(st, 'front');
  const stations = up(st, 'prep').stations ?? 1;
  const maxFront = tills(st) + 3;
  const delivers = (up(st, 'delivery').vehicleCap ?? 0) > 0 && st.deliveryOff !== true;
  const out: HourNeed[] = [];
  try {
    for (let h = 0; h < 12; h++) {
      const minute = OPEN_MIN + h * 60 + 30;
      const when = { day: ctx.day, minute, weather: ctx.weather, effects: ctx.effects };
      const walk = walkInRate(s, st, when);
      const delivery = delivers ? deliveryRate(s, st, true, when) : 0;
      // the kitchen cooks delivery orders too
      const target = (walk + delivery * 0.8) * HEADROOM + 0.5;
      let nc = 1, nf = 1;
      const equip: HourNeed['equip'] = {};
      for (let i = 0; i < 12; i++) {
        st.staff = [...fake('cook', nc, sc, 0), ...fake('front', nf, sf, 100)];
        const c = capacityAt(s, st, minute);
        if (c.capacity >= target) break;
        if (c.limit === 'kitchen' && nc < stations) nc++;
        else if (c.limit === 'kitchen') { equip.cook = true; break; }
        else if (c.limit === 'front' && nf < maxFront) nf++;
        else if (c.limit === 'tills' && nf < tills(st)) nf++;
        else if (c.limit === 'tills' || c.limit === 'front') { equip.front = true; break; }
        else break; // the oven: no amount of people fixes it
      }
      let nd = 0;
      if (delivery > 0.3) {
        st.staff = [...fake('cook', nc, sc, 0), ...fake('front', nf, sf, 100), ...fake('driver', 1, 2, 200)];
        const per = capacityAt(s, st, minute).driverCap;
        nd = per > 0 ? Math.min(4, Math.ceil((delivery * HEADROOM) / per)) : 0;
      }
      out.push({ h, walk, delivery, need: { cook: nc, front: nf, driver: nd }, equip });
    }
  } finally {
    st.staff = real;
  }
  return out;
}

/** Who is on in each hour of a weekday, by role, from the schedule. */
export function scheduledCounts(st: Store, dow: number, role: NeedRole): number[] {
  const out = new Array(12).fill(0);
  for (const x of st.staff) {
    if (x.role !== role) continue;
    const v = st.schedule[x.id]?.[dow] ?? x.shift;
    if (v === 'off') continue;
    for (let h = 0; h < 12; h++) {
      const m = OPEN_MIN + h * 60 + 30;
      if (m >= SHIFTS[v].start && m < SHIFTS[v].end) out[h]++;
    }
  }
  return out;
}

export const shiftLen = (v: ShiftId | 'off') => (v === 'off' ? 0 : (SHIFTS[v].end - SHIFTS[v].start) / 60);
const covers = (v: ShiftId, h: number) => {
  const m = OPEN_MIN + h * 60 + 30;
  return m >= SHIFTS[v].start && m < SHIFTS[v].end;
};

/** Weekly hours for someone over a run of days. */
export function weekHours(st: Store, x: Staff, days: number[]): number {
  return days.reduce((a, d) => a + shiftLen(st.schedule[x.id]?.[(d - 1) % 7] ?? x.shift), 0);
}

export interface BuildResult {
  /** People and the hours they got. */
  hours: { x: Staff; h: number }[];
  /** Hours the forecast needed that nobody was free for. */
  short: { day: number; role: NeedRole; h: number }[];
  changed: number;
}

/**
 * Build the editable days of the schedule, checked against the same capacity model the Cover
 * row uses, so "covered" on the grid and "enough people" here always agree.
 *
 * 1. Managers first (8-hour Opener/Closer slots, busiest halves first, 40 hours each).
 * 2. One cook and one front-of-house person every open hour of every day.
 * 3. Then, hour by hour, wherever customers would walk out: add the shift that covers the most
 *    short hours per paid hour for whichever role is the bottleneck. First sweep: only people
 *    with room under 40 hours. Second sweep: overtime up to 48, only for gaps still left.
 *    A shift that doesn't actually help (the make line, tills or oven are the limit) is undone.
 * 4. Drivers: enough on each hour for the deliveries expected.
 * 5. Hand shifts from anyone over 40 to anyone with room.
 * The same week always gives the same schedule. `fill` only adds people (the nightly top-up).
 */
export function buildSchedule(s: GameState, st: Store, days: number[], ctxFor: (day: number) => DayCtx, opts: { fill?: boolean; managersOnly?: boolean } = {}): BuildResult {
  const view = Array.from({ length: 7 }, (_, i) => (s.phase === 'report' ? s.day + 1 : s.day) + i);
  const managers = st.staff.filter((x) => x.role === 'manager').sort((a, b) => b.skill - a.skill || a.id - b.id);
  const smart = !!managers[0] && managers[0].skill >= 2;
  const shifts: ShiftId[] = smart ? ['open8', 'close8', 'lunch', 'dinner', 'mid', 'evening', 'full'] : ['open8', 'close8', 'lunch', 'dinner', 'full'];
  const before = JSON.stringify(st.schedule);
  const ctxs = new Map(days.map((d) => [d, ctxFor(d)]));
  const delivers = (up(st, 'delivery').vehicleCap ?? 0) > 0 && st.deliveryOff !== true;
  // demand per hour (walk-ins and deliveries) for each day
  const demand = new Map(days.map((d) => {
    const c = ctxs.get(d)!;
    return [d, Array.from({ length: 12 }, (_, h) => {
      const when = { day: c.day, minute: OPEN_MIN + h * 60 + 30, weather: c.weather, effects: c.effects };
      return { walk: walkInRate(s, st, when), delivery: delivers ? deliveryRate(s, st, true, when) : 0 };
    })];
  }));
  const load = (d: number) => demand.get(d)!.reduce((a, r) => a + r.walk + r.delivery, 0);
  const order = [...days].sort((a, b) => load(b) - load(a) || a - b);
  const short: BuildResult['short'] = [];
  for (const x of st.staff) st.schedule[x.id] ??= Array(7).fill(x.shift);
  const editable = new Set(days);
  const lockedDays = view.filter((d) => !editable.has(d));
  const hours = new Map(st.staff.map((x) => [x.id, weekHours(st, x, lockedDays)]));
  const hrs = (x: Staff) => hours.get(x.id) ?? 0;
  const dowOf = (d: number) => (d - 1) % 7;

  // ---- 1. managers
  if (managers.length && !opts.fill) {
    for (const d of days) for (const x of managers) st.schedule[x.id][dowOf(d)] = 'off';
    const slots: { d: number; v: ShiftId; w: number }[] = [];
    for (const d of days) {
      const n = demand.get(d)!;
      const lunch = n.slice(0, 6).reduce((a, r) => a + r.walk + r.delivery, 0), dinner = n.slice(6).reduce((a, r) => a + r.walk + r.delivery, 0);
      slots.push({ d, v: 'close8', w: dinner * 1.05 + 1000 * (dinner >= lunch ? 1 : 0) });
      slots.push({ d, v: 'open8', w: lunch + 1000 * (lunch > dinner ? 1 : 0) });
    }
    slots.sort((a, b) => b.w - a.w || a.d - b.d);
    for (const sl of slots) {
      const dow = dowOf(sl.d);
      const who = managers.filter((x) => st.schedule[x.id][dow] === 'off' && hrs(x) + 8 <= FULL_TIME).sort((a, b) => hrs(a) - hrs(b) || b.skill - a.skill)[0];
      if (!who) continue;
      st.schedule[who.id][dow] = sl.v;
      hours.set(who.id, hrs(who) + 8);
    }
  } else if (opts.fill) for (const d of days) for (const x of managers) hours.set(x.id, hrs(x) + shiftLen(st.schedule[x.id][dowOf(d)]));
  if (opts.managersOnly) return finish();

  const crewRoles: NeedRole[] = ['cook', 'front', 'driver'];
  const teamOf = (role: NeedRole) => st.staff.filter((x) => x.role === role).sort((a, b) => b.skill - a.skill || b.morale - a.morale || a.id - b.id);
  if (!opts.fill) {
    for (const d of days) for (const x of st.staff) if (x.role !== 'manager') st.schedule[x.id][dowOf(d)] = 'off';
  } else {
    for (const d of days) for (const x of st.staff) if (x.role !== 'manager') hours.set(x.id, hrs(x) + shiftLen(st.schedule[x.id][dowOf(d)]));
  }

  /** Put someone on a shift that day: the best person with room under `cap` hours, else stretch someone already on. */
  const place = (role: NeedRole, dow: number, v: ShiftId, cap: number, hit: (v2: ShiftId) => boolean): Staff | null => {
    const team = teamOf(role);
    const len = shiftLen(v);
    const who = team.find((x) => st.schedule[x.id][dow] === 'off' && hrs(x) + len <= Math.min(cap, FULL_TIME)) ?? team.find((x) => st.schedule[x.id][dow] === 'off' && hrs(x) + len <= cap);
    if (who) {
      st.schedule[who.id][dow] = v;
      hours.set(who.id, hrs(who) + len);
      return who;
    }
    // nobody free: stretch someone already on today into the whole day, if they have room
    const stretch = team
      .filter((x) => {
        const cur = st.schedule[x.id][dow];
        return cur !== 'off' && cur !== 'full' && hrs(x) + 12 - shiftLen(cur) <= cap && !hit(cur);
      })
      .sort((a, b) => hrs(a) - hrs(b))[0];
    if (!stretch) return null;
    const cur = st.schedule[stretch.id][dow] as ShiftId;
    st.schedule[stretch.id][dow] = 'full';
    hours.set(stretch.id, hrs(stretch) + 12 - shiftLen(cur));
    return stretch;
  };
  const scoreShift = (v: ShiftId, want: boolean[]) => {
    let hit = 0;
    for (let h = 0; h < 12; h++) if (want[h] && covers(v, h)) hit++;
    if (!hit) return 0;
    const len = shiftLen(v);
    return (hit / len) * (len === 8 ? 1.08 : len >= 12 ? 0.8 : 1) + hit * 0.001;
  };

  // ---- 2. one cook and one front-of-house person every open hour
  for (const d of order) {
    const dow = dowOf(d);
    for (const role of ['cook', 'front'] as NeedRole[]) {
      if (!teamOf(role).length) continue;
      for (let guard = 0; guard < 6; guard++) {
        const have = scheduledCounts(st, dow, role);
        const want = have.map((n) => n < 1);
        if (!want.some(Boolean)) break;
        let best: ShiftId | null = null, bs = 0;
        for (const v of shifts) {
          const sc = scoreShift(v, want);
          if (sc > bs) [best, bs] = [v, sc];
        }
        if (!best || !place(role, dow, best, 999, (cur) => want.every((w, h) => !w || covers(cur, h)))) break;
      }
    }
  }

  // ---- 3. the rest of the forecast, checked against real capacity
  const ROLE_FOR: Partial<Record<string, NeedRole>> = { kitchen: 'cook', front: 'front', tills: 'front', nobody: 'front' };
  const stuck = new Set<string>(); // day|hour|role that more people can't fix
  const capRows = (d: number) => withSchedule(st, dowOf(d), () => demand.get(d)!.map((r, h) => {
    const c = capacityAt(s, st, OPEN_MIN + h * 60 + 30);
    // the kitchen also cooks the deliveries; the till side only serves walk-ins
    const need = r.walk + (c.limit === 'kitchen' ? r.delivery * 0.6 : 0);
    return { short: need - c.capacity, role: ROLE_FOR[c.limit], cap: c.capacity };
  }));
  for (const cap of [FULL_TIME, MAX_HOURS]) {
    // "nobody left under this cap" only holds for this sweep; the overtime sweep tries again
    const noOne = new Set<string>();
    for (const d of order) {
      const dow = dowOf(d);
      for (let guard = 0; guard < 40; guard++) {
        const rows = capRows(d);
        const open = (h: number, role: NeedRole) => !stuck.has(`${d}|${h}|${role}`) && !noOne.has(`${d}|${h}|${role}`);
        const worst = rows.map((r, h) => ({ r, h })).filter(({ r, h }) => r.short > 0.4 && r.role && open(h, r.role)).sort((a, b) => b.r.short - a.r.short)[0];
        if (!worst) break;
        const role = worst.r.role!;
        const want = rows.map((r, h) => r.short > 0.4 && r.role === role && open(h, role));
        // the shift must cover the worst hour; among those, the most short hours per paid hour
        let best: ShiftId | null = null, bs = 0;
        for (const v of shifts) {
          if (!covers(v, worst.h)) continue;
          const sc = scoreShift(v, want);
          if (sc > bs) [best, bs] = [v, sc];
        }
        const snapshot = JSON.stringify(st.schedule);
        const hoursBefore = new Map(hours);
        const who = best ? place(role, dow, best, cap, (cur) => covers(cur, worst.h)) : null;
        if (!who) {
          for (let h = 0; h < 12; h++) if (want[h]) noOne.add(`${d}|${h}|${role}`);
          continue;
        }
        // did it help where it was needed? if capacity at the worst hour barely moved, the make
        // line, tills or oven are the limit there: undo it and leave that hour alone
        const after = capRows(d)[worst.h];
        if (after.cap < worst.r.cap + 0.3) {
          Object.assign(st.schedule, JSON.parse(snapshot));
          hours.clear();
          for (const [k, v] of hoursBefore) hours.set(k, v);
          stuck.add(`${d}|${worst.h}|${role}`);
        }
      }
    }
  }

  // ---- 4. drivers: enough for the deliveries expected each hour
  const drivers = teamOf('driver');
  if (drivers.length && delivers) {
    for (const cap of [FULL_TIME, MAX_HOURS]) for (const d of order) {
      const dow = dowOf(d);
      for (let guard = 0; guard < 16; guard++) {
        const want = withSchedule(st, dow, () => demand.get(d)!.map((r, h) => r.delivery > 0.3 && capacityAt(s, st, OPEN_MIN + h * 60 + 30).driverCap < r.delivery - 0.3));
        if (!want.some(Boolean)) break;
        let best: ShiftId | null = null, bs = 0;
        for (const v of shifts) {
          const sc = scoreShift(v, want);
          if (sc > bs) [best, bs] = [v, sc];
        }
        if (!best || !place('driver', dow, best, cap, (cur) => want.every((w, h) => !w || covers(cur, h)))) break;
      }
    }
  }

  // what's still short after everything (for the summary)
  for (const d of days) {
    const rows = capRows(d);
    rows.forEach((r, h) => {
      if (r.short > 0.75 && r.role && !stuck.has(`${d}|${h}|${r.role}`)) short.push({ day: d, role: r.role, h });
    });
  }

  // ---- 5. even out overtime: hand a shift from anyone over 40 to someone with room who's off that day
  for (const role of crewRoles) {
    const team = teamOf(role);
    for (let guard = 0; guard < 40; guard++) {
      let moved = false;
      for (const x of team.filter((q) => hrs(q) > FULL_TIME).sort((a, b) => hrs(b) - hrs(a))) {
        for (const d of days) {
          const dow = dowOf(d);
          const v = st.schedule[x.id][dow];
          if (v === 'off') continue;
          const len = shiftLen(v);
          const to = team.filter((y) => y !== x && st.schedule[y.id][dow] === 'off' && hrs(y) + len <= FULL_TIME).sort((a, b) => b.skill - a.skill || hrs(a) - hrs(b))[0];
          if (!to) continue;
          st.schedule[to.id][dow] = v;
          st.schedule[x.id][dow] = 'off';
          hours.set(x.id, hrs(x) - len);
          hours.set(to.id, hrs(to) + len);
          moved = true;
          break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }
  }
  return finish();

  function finish(): BuildResult {
    let changed = 0;
    const was = JSON.parse(before) as Store['schedule'];
    for (const x of st.staff) for (const d of days) if (was[x.id]?.[(d - 1) % 7] !== st.schedule[x.id][(d - 1) % 7]) changed++;
    return { hours: st.staff.map((x) => ({ x, h: weekHours(st, x, view) })), short, changed };
  }
}

/** Rebuild every day from two days out (what Suggest and auto-schedule do). */
export function rebuildWeek(s: GameState, st: Store): BuildResult {
  st.weekly = true;
  const view = Array.from({ length: 7 }, (_, i) => (s.phase === 'report' ? s.day + 1 : s.day) + i);
  return buildSchedule(s, st, view.filter((d) => d >= s.day + 2), (d) => ctxForDay(s, d));
}

/** A short, plain summary of a built schedule for a toast. */
export function buildSummary(st: Store, r: BuildResult, who: string | null): string {
  const crew = r.hours.filter((q) => q.x.role !== 'manager');
  const name = (q: { x: Staff }) => q.x.name.split(' ')[0];
  const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const full = crew.filter((q) => q.h >= 32 && q.h <= MAX_HOURS).length;
  const part = crew.filter((q) => q.h > 0 && q.h < 32).length;
  const long = crew.filter((q) => q.h > MAX_HOURS);
  const none = crew.filter((q) => q.h === 0);
  const bits: string[] = [];
  if (full) bits.push(`${full} full-time`);
  if (part) bits.push(`${part} part-time`);
  let msg = `${who ? `${who} planned` : 'Planned'} the week from the forecast: ${bits.join(', ') || 'nobody needed'}`;
  if (none.length) msg += `, with ${list(none.map(name))} on call (not needed this week)`;
  msg += '.';
  if (long.length) msg += ` ${list(long.map((q) => `${name(q)} (${q.h}h)`))} ${long.length === 1 ? 'is' : 'are'} working long weeks to keep the doors open.`;
  if (r.short.length || long.length) {
    const roles = [...new Set([...r.short.map((q) => q.role), ...long.map((q) => q.x.role as NeedRole)])].map((k) => ROLES[k].name.toLowerCase());
    msg += st.staff.length >= MAX_STAFF
      ? ` Still a little short on ${roles.join(' and ')} at the biggest rushes, and the store is at its ${MAX_STAFF}-person limit: training raises what each person can handle, and a faster make line or registers cover more with the same crew.`
      : ` Hiring another ${roles.join(' and another ')} would cover the rushes and keep everyone near 40 hours.`;
  }
  void st;
  return msg;
}

// Staff: candidates, wages, speed, skill growth, morale.
import { ITEM, type ItemId } from '../data/catalog';
import { FIRST_NAMES, LAST_INITIALS } from '../data/text';
import { ROLES, MAX_MANAGERS, SHIFTS, TRAITS, traitFits, type Role, type ShiftId, type TraitId } from '../data/world';
import type { Candidate, GameState, Look, MoraleReason, Staff, Store } from './types';
import { clamp, pickOne, rand, randInt, news, money } from './util';
import { DIFFICULTY, hasManager, up } from './state';
import { BACK_OUT } from './layout';

export function randomLook(s: GameState): Look {
  return { skin: randInt(s, 0, 5), hair: randInt(s, 0, 6), shirt: randInt(s, 0, 9), pants: randInt(s, 0, 4), height: 0.92 + rand(s) * 0.16 };
}

export function marketWage(role: Role, skill: number) {
  const r = ROLES[role];
  return Math.round((r.baseWage + r.perSkill * (skill - 1)) * 4) / 4;
}

/** Minutes of actual work needed to reach the next skill level. */
export const SKILL_XP = [0, 600, 1300, 2300, 3600];
export function xpToNext(skill: number) {
  return SKILL_XP[Math.min(skill, 4)] || 9999;
}
/** Evening class: no time off, back one skill level higher the next morning. */
export function trainingCost(skill: number) {
  return [0, 150, 350, 650, 1100][skill] ?? 0;
}
export function trainingReq(skill: number) {
  return [0, 1, 3, 4, 6][skill] ?? 99;
}

const ROLE_POOL: Role[] = ['cook', 'cook', 'cook', 'front', 'front', 'front', 'driver'];
const GOOD: TraitId[] = ['speedy', 'charming', 'upseller', 'perfectionist', 'steady', 'reliable', 'veteran', 'nightowl', 'tidy', 'navigator', 'mentor', 'earlybird', 'teamplayer', 'ambitious', 'multitasker'];
const BAD: TraitId[] = ['clumsy', 'slacker', 'grumpy', 'sensitive'];
const CLASH: [TraitId, TraitId][] = [['speedy', 'slacker'], ['clumsy', 'steady'], ['charming', 'grumpy'], ['earlybird', 'nightowl'], ['reliable', 'sensitive']];

/** Applicants waiting at once (more with a job ad running). */
export function poolSize(s: GameState, st: Store) {
  // a good reputation draws a few more applicants, a bad one a few less
  const rep = st.rating >= 4 ? 1 : st.rating < 2.5 ? -1 : 0;
  return 6 + (s.level >= 5 ? 1 : 0) + (st.jobAd > 0 ? 3 : 0) + rep;
}

function rollTraits(s: GameState, role: Role, count: number): TraitId[] {
  const traits: TraitId[] = [];
  for (let tries = 0; traits.length < count && tries < 12; tries++) {
    const pool = (rand(s) < 0.72 ? GOOD : BAD).filter((t) => traitFits(t, role));
    if (!pool.length) continue;
    const t = pickOne(s, pool);
    if (traits.includes(t) || CLASH.some(([a, b]) => (t === a && traits.includes(b)) || (t === b && traits.includes(a)))) continue;
    traits.push(t);
  }
  return traits;
}

/** What an applicant's skill and traits are worth per hour (the yardstick for "good deal"). */
export function fairWage(s: GameState, c: { role: Role; skill: number; traits: TraitId[] }) {
  // a diamond in the rough doesn't know it yet: they ask what anyone at their skill would
  const shown = c.traits.filter((t) => t !== 'diamond');
  const good = shown.filter((t) => TRAITS[t].good).length - shown.filter((t) => !TRAITS[t].good).length;
  return marketWage(c.role, c.skill) * DIFFICULTY[s.difficulty].wage * (1 + good * 0.05);
}
/** How good a deal an applicant is: asking wage vs what they're worth. */
export function dealRating(s: GameState, c: { role: Role; skill: number; traits: TraitId[]; wage: number }): { label: string; tone: 'good' | 'warn' | 'bad' | ''; worth: number } {
  const worth = fairWage(s, c);
  const r = c.wage / worth;
  if (r <= 0.94) return { label: 'Great deal', tone: 'good', worth };
  if (r <= 1.01) return { label: 'Good deal', tone: 'good', worth };
  if (r <= 1.08) return { label: 'Fair', tone: '', worth };
  return { label: 'Pricey', tone: 'warn', worth };
}

function makeCandidate(s: GameState, st: Store, role: Role, traitCount: number): Candidate {
  const ad = st.jobAd > 0 ? 0.1 : 0;
  const r3 = 0.08 + ad + Math.min(0.3, s.level * 0.03) + (st.rating - 3) * 0.05;
  const roll = rand(s);
  let skill = roll < r3 ? 3 : roll < r3 + 0.35 ? 2 : 1;
  if (s.level >= 8 && rand(s) < 0.15 + ad) skill = 4;
  if (role === 'manager') skill = Math.max(2, skill);
  const traits = rollTraits(s, role, traitCount);
  // rare finds, about 1 in 30 applicants: a raw talent, or someone people follow
  const rare = rand(s);
  if (rare < 0.018) {
    skill = 1;
    traits.splice(0, traits.length, ...traits.filter((t) => TRAITS[t].good).slice(0, 1), 'diamond');
  } else if (rare < 0.033 && role !== 'driver') traits.push('leader');
  const base = { role, skill, traits };
  const wage = Math.round(fairWage(s, base) * (0.88 + rand(s) * 0.26) * 4) / 4;
  return { id: ++s.nextId, name: randomName(s), role, skill, wage, traits, look: randomLook(s), daysLeft: randInt(s, 2, 4) };
}

/**
 * The hiring pool. Applicants stick around a few days, then take other jobs; new ones arrive
 * each morning. The pool always has kitchen and front-of-house people (and drivers once you
 * deliver), and a mix of trait-less and trait-heavy applicants.
 */
export function rollCandidates(s: GameState, st: Store, refresh = true): Candidate[] {
  let pool = (st.candidates ?? []).filter((c) => (c.daysLeft ?? 0) > (refresh ? 1 : 0));
  if (refresh) for (const c of pool) c.daysLeft = (c.daysLeft ?? 2) - 1;
  const size = poolSize(s, st);
  const want: Role[] = ['cook', 'front', 'cook', 'front'];
  if (st.upgrades.delivery > 0) want.push('driver', 'driver');
  // managers: one applicant around until you have a full team of them (one per shift and day off)
  const mgrs = st.staff.filter((x) => x.role === 'manager').length;
  if (s.level >= 4 && mgrs < MAX_MANAGERS) want.push('manager');
  const have = (r: Role) => pool.filter((c) => c.role === r).length;
  const roles: Role[] = [];
  for (const r of new Set(want)) {
    const need = want.filter((x) => x === r).length - have(r);
    for (let i = 0; i < need; i++) roles.push(r);
  }
  while (pool.length + roles.length < size) roles.push(pickOne(s, ROLE_POOL.filter((r) => r !== 'driver' || st.upgrades.delivery > 0)));
  for (const role of roles) {
    // roughly 40% no traits, 45% one, 15% two
    const r = rand(s);
    pool.push(makeCandidate(s, st, role, r < 0.4 ? 0 : r < 0.85 ? 1 : 2));
  }
  // never all-or-nothing on traits
  const withT = pool.filter((c) => c.traits.length).length;
  if (pool.length >= 3 && withT === 0) {
    const c = pool[pool.length - 1];
    c.traits = rollTraits(s, c.role, 1);
  } else if (pool.length >= 3 && withT === pool.length) pool[pool.length - 1].traits = [];
  pool = pool.slice(-Math.max(size, pool.length));
  return pool;
}

export function randomName(s: GameState) {
  return `${pickOne(s, FIRST_NAMES)} ${LAST_INITIALS[Math.floor(rand(s) * LAST_INITIALS.length)]}.`;
}

export function makeStaffFromCandidate(s: GameState, c: Candidate): Staff {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    skill: c.skill,
    xp: 0,
    morale: 70,
    energy: 100,
    wage: c.wage,
    traits: c.traits.filter((t) => traitFits(t, c.role)),
    hiredDay: s.day,
    status: 'active',
    statusDays: 0,
    task: null,
    busyMin: 0,
    shiftMin: 0,
    tasksToday: 0,
    bonusDay: -1,
    look: c.look,
    shift: 'full',
    offToday: false,
    pos: [...BACK_OUT],
    onFloor: false,
    spot: -1,
    course: false,
    moraleWhy: [],
    lowNights: 0,
    moraleStart: 70,
  };
}

/** Bring an older save's staff record up to date. */
export function migrateStaff(x: Staff) {
  const legacy = x.role as string;
  if (legacy === 'cashier' || legacy === 'cleaner') x.role = 'front';
  x.traits = (x.traits ?? []).filter((t) => t in TRAITS && traitFits(t, x.role));
  if (x.status === 'training') {
    x.status = 'active';
    x.statusDays = 0;
  }
  x.shift ??= 'full';
  x.offToday ??= false;
  x.pos ??= [...BACK_OUT];
  x.onFloor ??= false;
  x.spot ??= -1;
  x.course ??= false;
  x.moraleWhy ??= [];
  x.lowNights ??= 0;
  x.moraleStart ??= x.morale;
  x.shiftMin ??= 0;
  x.xp = Math.min(x.xp * 6, xpToNext(x.skill) - 1);
  if (x.task) x.task = null;
}

/** Work-speed multiplier (1.0 = baseline). */
export function staffSpeed(s: GameState, st: Store, x: Staff): number {
  // 0.3.29: everyone a little quicker (about 8%), so a lean crew can keep up
  let v = 0.73 + 0.15 * x.skill;
  v *= 0.8 + 0.4 * (x.morale / 100);
  v *= 0.75 + 0.25 * (x.energy / 100);
  if (x.traits.includes('speedy')) v *= 1.15;
  if (x.traits.includes('slacker')) v *= 0.85;
  if (x.traits.includes('perfectionist')) v *= 0.92;
  if (x.traits.includes('nightowl') && s.minute >= 18 * 60) v *= 1.1;
  if (x.traits.includes('earlybird') && s.minute < 14 * 60) v *= 1.1;
  // a manager on site keeps everyone moving; a better manager more so
  // the best manager on today counts (two managers don't stack)
  const mgr = st.staff.filter((y) => y.role === 'manager' && y.status === 'active' && !y.offToday && y.onFloor).sort((a, b) => b.skill - a.skill)[0];
  if (mgr && x.role !== 'manager') v *= 1.05 + 0.02 * mgr.skill;
  // a natural leader on the floor lifts everyone else on shift
  let lead = 1;
  for (const y of st.staff) if (y !== x && y.onFloor && y.skill >= 2 && y.traits.includes('leader')) lead = Math.max(lead, 1 + Math.min(0.08, 0.02 * (y.skill - 1)));
  v *= lead;
  if (x.boost?.day === s.day) v *= x.boost.mult;
  if (st.teamBoost && s.day <= st.teamBoost.until) v *= st.teamBoost.mult;
  return v;
}

/** Evening class price: a diamond in the rough takes to it at half price. */
export function trainingCostFor(x: Staff) {
  return Math.round(trainingCost(x.skill) * (x.traits.includes('diamond') ? 0.5 : 1));
}

/** How error-prone someone is right now: green or exhausted staff slip up more. Kept gentle. */
export function mistakeMult(x: Staff): number {
  let m = 1.25 - 0.15 * x.skill; // skill 1: 1.1, skill 5: 0.5
  if (x.energy < 30) m *= 1.5;
  return m;
}

/** Chance this person drops the pizza they are handling. Rare: most remakes have other causes. */
export function dropChance(x: Staff): number {
  if (x.traits.includes('steady')) return 0;
  let p = 0.0025 * mistakeMult(x);
  if (x.traits.includes('clumsy')) p *= 4;
  return p;
}

/** Toppings beyond the base (dough, sauce, cheese) that a cook has to get right. */
export function toppingCount(item: ItemId): number {
  return Object.keys(ITEM[item].recipe).filter((k) => !['dough', 'sauce', 'cheese', 'bbq', 'soda', 'box'].includes(k)).length;
}

/** Chance a pizza goes out with the wrong toppings and gets caught at the pass. Near zero at 1 or 2 toppings. */
export function wrongToppingChance(x: Staff, item: ItemId): number {
  const extra = Math.max(0, toppingCount(item) - 2);
  let p = extra * 0.0035 * mistakeMult(x);
  if (x.traits.includes('perfectionist')) p *= 0.4;
  return p;
}

/** Experience is earned per minute of real work. */
export function gainXp(s: GameState, st: Store, x: Staff, minutes: number) {
  if (x.skill >= 5 || minutes <= 0) return;
  let m = x.traits.includes('veteran') ? 1.5 : 1;
  if (x.traits.includes('ambitious')) m *= 1.25;
  if (x.traits.includes('diamond')) m *= 2;
  if (st.staff.some((y) => y.role === 'manager' && y.onFloor && y.traits.includes('mentor'))) m *= 1.25;
  x.xp += minutes * m;
  const need = xpToNext(x.skill);
  if (x.xp >= need) {
    x.xp -= need;
    x.skill++;
    news(s, `${x.name} improved to ${ROLES[x.role].name} skill ${x.skill} on the job. They'll expect about ${money(marketWage(x.role, x.skill), true)}/hr now.`, 'good');
  }
}

export function moodLabel(m: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (m >= 70) return { label: 'Happy', tone: 'good' };
  if (m >= 45) return { label: 'Content', tone: 'good' };
  if (m >= 30) return { label: 'Unhappy', tone: 'warn' };
  if (m >= 20) return { label: 'Fed up', tone: 'bad' };
  return { label: 'About to quit', tone: 'bad' };
}

export const QUIT_LINE = 20;

/** End-of-day morale/energy/status update. Returns quitters and warnings for the report. */
export function nightlyStaff(s: GameState, st: Store): { quit: Staff[]; notes: string[] } {
  const quit: Staff[] = [];
  const notes: string[] = [];
  const brk = up(st, 'breakroom');
  const mgr = st.staff.some((y) => y.role === 'manager' && y.status === 'active' && !y.offToday);
  const D = DIFFICULTY[s.difficulty];
  for (const x of st.staff) {
    // status timers
    if (x.status === 'training') x.status = 'active';
    if (x.status === 'sick') {
      x.statusDays--;
      if (x.statusDays <= 0) x.status = 'active';
    }
    if (x.course) {
      x.course = false;
      if (x.skill < 5) {
        x.skill++;
        news(s, `${x.name} finished evening class: now ${ROLES[x.role].name} skill ${x.skill}. Market rate is ${money(marketWage(x.role, x.skill), true)}/hr.`, 'good', false);
        notes.push(`${x.name} finished training and is now skill ${x.skill}.`);
      }
    }
    const why: MoraleReason[] = [];
    const market = marketWage(x.role, x.skill);
    const pay = ((x.wage - market) / market) * 40;
    if (Math.abs(pay) >= 0.5) why.push({ label: pay > 0 ? `Paid ${money(x.wage - market, true)}/hr above market` : `Paid ${money(market - x.wage, true)}/hr below market`, v: pay });
    const calledIn = x.callIn?.day === s.day;
    const worked = x.status === 'active' && (!x.offToday || calledIn) && x.shiftMin > 30;
    if (worked) {
      const busy = x.busyMin / Math.max(1, x.shiftMin);
      if (busy > 0.85) why.push({ label: `Run off their feet (${Math.round(busy * 100)}% busy)`, v: -6 });
      else if (busy > 0.7) why.push({ label: `Busy shift (${Math.round(busy * 100)}% busy)`, v: -2 });
      else if (busy < 0.3) why.push({ label: 'Easy shift', v: 1 });
      if (x.shift === 'full' && (brk.morale ?? 0) === 0) why.push({ label: '12-hour shift with no breakroom', v: -1.5 });
    }
    if (x.offToday && !calledIn) why.push({ label: 'Day off', v: 12 });
    // people want hours: a week with almost none (on call, never needed) wears on them
    const wk = (x.hoursLog ?? []).slice(-7);
    if (wk.length >= 7 && x.role !== 'manager' && wk.reduce((a, b) => a + b, 0) < 12) why.push({ label: 'Barely getting any hours', v: -3 });
    if (calledIn) why.push(x.callIn!.why === 'cover' ? { label: 'Covered for a sick coworker', v: 2 } : x.offToday ? { label: 'Came in on a day off to help', v: 2 } : { label: 'Stayed late to help', v: -1 });
    if (calledIn && x.traits.includes('teamplayer')) why.push({ label: 'Glad to help out', v: 2 });
    if (x.traits.includes('diamond')) why.push({ label: 'Loves the job', v: 2 });
    if (x.role === 'manager' && (st.today.mgrJumps ?? 0) > 6) why.push({ label: `Had to jump on the line ${st.today.mgrJumps} times`, v: -Math.min(6, (st.today.mgrJumps ?? 0) * 0.3) });
    if (brk.morale) why.push({ label: 'Breakroom', v: brk.morale });
    if (mgr && x.role !== 'manager') why.push({ label: 'Good manager on site', v: 2 });
    if (x.role === 'driver' && (x.tipsToday ?? 0) >= 15) why.push({ label: `Good tips tonight (${money(x.tipsToday ?? 0)})`, v: Math.min(4, (x.tipsToday ?? 0) / 15) });
    if (worked && st.staff.some((y) => y !== x && y.traits.includes('teamplayer') && y.status === 'active' && !y.offToday && shiftsOverlap(x.shift, y.shift))) why.push({ label: 'Great teammate on shift', v: 1 });
    if (x.traits.includes('ambitious') && x.wage <= market + 0.5) why.push({ label: 'Ambitious: wants to be paid above market', v: -2 });
    const drift = (60 - x.morale) * 0.05;
    if (Math.abs(drift) >= 0.5) why.push({ label: drift > 0 ? 'Bouncing back' : 'Novelty wearing off', v: drift });
    let d = 0;
    for (const r of why) {
      if (r.v < 0) r.v *= D.moraleLoss;
      if (x.traits.includes('reliable') && r.v < 0) r.v *= 0.5;
      if (x.traits.includes('sensitive') && r.v < 0) r.v *= 1.5;
      d += r.v;
    }
    const before = x.morale;
    x.morale = clamp(x.morale + clamp(d, -15, 14), 0, 100);
    x.moraleWhy = why.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    // warnings before anyone walks out
    const worst = x.moraleWhy.find((r) => r.v < 0)?.label.toLowerCase();
    if (x.morale < QUIT_LINE) {
      x.lowNights++;
      if (x.lowNights >= 2 && rand(s) < 0.75) quit.push(x);
      else if (x.lowNights === 1) {
        const msg = `${x.name} is fed up${worst ? ` (${worst})` : ''} and will quit after tomorrow unless morale gets above ${QUIT_LINE}. A raise, bonus or day off helps.`;
        notes.push(msg);
        news(s, msg, 'bad', false);
      }
    } else {
      x.lowNights = 0;
      if (x.morale < 35 && before >= 35) {
        const msg = `${x.name} is unhappy${worst ? `: ${worst}` : ''}.`;
        notes.push(msg);
        news(s, msg, 'bad', false);
      }
    }
    if (worked) {
      x.record = [...(x.record ?? []), { day: s.day, tasks: x.tasksToday, min: Math.round(x.shiftMin), busy: Math.round(x.busyMin), drops: x.dropsToday ?? 0 }].slice(-7);
      // a hidden talent shows itself after a few shifts
      if (x.traits.includes('diamond') && !x.revealed && (x.record.length >= 3)) {
        x.revealed = true;
        const msg = `${x.name} is a natural: a real diamond in the rough. They learn twice as fast and training costs half.`;
        notes.push(msg);
        news(s, msg, 'good', false);
      }
    }
    x.dropsToday = 0;
    x.moraleStart = x.morale;
    x.energy = 100;
    x.busyMin = 0;
    x.roadMin = 0;
    x.tipsToday = 0;
    x.shiftMin = 0;
    x.tasksToday = 0;
    x.task = null;
    x.offToday = false;
    x.onFloor = false;
    x.callIn = undefined;
    x.pos = [...BACK_OUT];
  }
  for (const q of quit) {
    st.staff.splice(st.staff.indexOf(q), 1);
    news(s, `${q.name} quit. Morale was too low.`, 'bad');
  }
  return { quit, notes };
}

export function shiftsOverlap(a: ShiftId, b: ShiftId) {
  return SHIFTS[a].start < SHIFTS[b].end && SHIFTS[b].start < SHIFTS[a].end;
}

/**
 * Performance review: tasks per hour on the floor compared with teammates in the same role,
 * plus drops and pay. Grades A (standout) to D (struggling).
 */
export function performance(st: Store, x: Staff) {
  const rec = x.record ?? [];
  const rate = (r: NonNullable<Staff['record']>) => {
    const min = r.reduce((a, d) => a + d.min, 0);
    return min > 30 ? (r.reduce((a, d) => a + d.tasks, 0) / min) * 60 : null;
  };
  const mine = rate(rec);
  const peers = st.staff.filter((y) => y.role === x.role && y !== x && (y.record?.length ?? 0) >= 2).map((y) => rate(y.record ?? [])).filter((v): v is number => v !== null && v > 0.3);
  const avg = peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : null;
  const busyMin = rec.reduce((a, d) => a + d.busy, 0), floorMin = rec.reduce((a, d) => a + d.min, 0);
  const drops = rec.reduce((a, d) => a + d.drops, 0);
  // compare against teammates when there are any, otherwise against how busy they keep
  let score = avg && mine !== null ? mine / avg : floorMin > 30 ? 0.75 + (busyMin / floorMin) * 0.5 : 1;
  score -= Math.min(0.2, drops * 0.03);
  score += (x.skill - 2) * 0.04;
  const grade = rec.length < 2 ? '—' : score >= 1.12 ? 'A' : score >= 0.95 ? 'B' : score >= 0.8 ? 'C' : 'D';
  const market = marketWage(x.role, x.skill);
  const notes: string[] = [];
  if (rec.length < 2) notes.push('Not enough shifts yet for a fair review.');
  else {
    if (grade === 'A') notes.push('A standout. Worth keeping happy.');
    if (grade === 'D' || grade === 'C') notes.push(x.skill <= 2 ? `Still green at skill ${x.skill}: training (${money(trainingCostFor(x))}) would help more than a raise.` : 'Underperforming for their skill. Check morale and energy.');
    if (drops >= 3) notes.push(`${drops} pizzas remade this week.`);
    if (x.morale < 45) notes.push('Low morale is slowing them down.');
    if (x.wage < market - 0.25) notes.push(`Paid ${money(market - x.wage, true)}/hr under market.`);
    else if (x.wage > market + 1.5 && (grade === 'C' || grade === 'D')) notes.push('Paid well above market for this performance.');
  }
  const raise = rec.length >= 2 && (grade === 'A' || (grade === 'B' && x.wage <= market + 0.5) || x.wage < market - 0.25);
  return { grade, perHour: mine, teamAvg: avg, drops, busy: floorMin ? busyMin / floorMin : null, days: rec.length, notes, raise };
}

export function shiftLabel(x: Staff) {
  return SHIFTS[x.shift].short;
}

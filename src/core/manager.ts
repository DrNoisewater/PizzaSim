// What a manager does besides lending a hand: covers call-offs, fixes tomorrow's schedule,
// texts the crew for help in a rush, sends end-of-day crew messages, and gives better tips.
// Everything here is manager-only, and a better manager (higher skill) does each thing better.
import { ROLES, SHIFTS, CLOSE_MIN, OPEN_MIN, DAY_NAMES, type ShiftId } from '../data/world';
import type { GameState, Staff, Store } from './types';
import { clamp, emit, news, pickOne, rand } from './util';
import { staffingGaps, withSchedule, ctxForDay } from './forecast';
import { buildSchedule, rebuildWeek } from './scheduler';

/** The store's manager, if they're working today. */
export function storeManager(st: Store): Staff | null {
  return st.staff.find((x) => x.role === 'manager' && x.status === 'active' && !x.offToday) ?? null;
}
/** The manager, if they're on the floor right now. */
export function managerOnFloor(st: Store): Staff | null {
  return st.staff.find((x) => x.role === 'manager' && x.onFloor) ?? null;
}
const first = (x: Staff) => x.name.split(' ')[0];
const note = (st: Store, msg: string) => (st.today.mgrNotes ??= []).push(msg);

/** How likely someone is to say yes to coming in: happy, reliable team players say yes. */
function willing(x: Staff, base: number): number {
  let p = base + (x.morale - 55) / 200;
  if (x.traits.includes('teamplayer')) p += 0.2;
  if (x.traits.includes('reliable')) p += 0.1;
  if (x.traits.includes('grumpy')) p -= 0.12;
  if (x.traits.includes('slacker')) p -= 0.1;
  return clamp(p, 0.05, 0.95);
}

// ------------------------------------------------------------------ call-offs (morning)

/**
 * Someone called in sick: the manager phones around for cover. Someone off today in the same
 * role takes the shift. A better manager tries more people and talks them round more often.
 */
export function coverCallOffs(s: GameState, st: Store) {
  const sick = st.staff.filter((x) => x.status === 'sick' && x.statusDays >= 1 && !x.offToday);
  if (!sick.length) return;
  const m = storeManager(st);
  for (const x of sick) {
    const sh = SHIFTS[x.shift];
    if (!m) {
      news(s, `${x.name} is out sick. No manager to find cover, so you're a ${ROLES[x.role].name.toLowerCase()} down today.`, 'bad');
      continue;
    }
    const pool = st.staff
      .filter((y) => y.role === x.role && y.status === 'active' && y.offToday && !y.callIn)
      .sort((a, b) => willing(b, 0.5) - willing(a, 0.5));
    const tries = 1 + Math.floor(m.skill / 2);
    let got: Staff | null = null;
    for (const y of pool.slice(0, tries)) {
      if (rand(s) < willing(y, 0.35 + 0.08 * m.skill)) {
        got = y;
        break;
      }
    }
    if (got) {
      got.offToday = false;
      got.shift = x.shift;
      got.callIn = { day: s.day, from: sh.start, until: sh.end, why: 'cover' };
      const msg = `${x.name} is out sick. ${first(m)} got ${got.name} to cover the ${SHIFTS[x.shift].name} shift.`;
      news(s, msg, 'good');
      note(st, msg);
    } else {
      const msg = `${x.name} is out sick. ${first(m)} ${pool.length ? `tried ${Math.min(pool.length, tries)} ${Math.min(pool.length, tries) === 1 ? 'person' : 'people'} but nobody could come in` : `had nobody free to call`}.`;
      news(s, msg, 'bad');
      note(st, msg);
    }
  }
}

// ------------------------------------------------------------------ tomorrow (end of day)

/**
 * Tomorrow is locked for the player, so the manager (or auto-schedule) looks it over with the
 * latest forecast, events included: if a rush is short and someone in that role is off, they
 * get a shift. Only adds people. Auto-schedule also rebuilds the days after that.
 */
export function managerFixTomorrow(s: GameState, st: Store): string | null {
  const m = st.staff.find((x) => x.role === 'manager') ?? null;
  if (!st.weekly || (!m && !st.autoSchedule)) return null;
  const day = s.day + 1;
  const dow = (day - 1) % 7;
  const before = st.staff.map((x) => st.schedule[x.id]?.[dow] ?? x.shift);
  buildSchedule(s, st, [day], (d) => ctxForDay(s, d), { fill: true });
  const added = st.staff.filter((x, i) => before[i] !== st.schedule[x.id]?.[dow]);
  if (st.autoSchedule) rebuildWeek(s, st);
  if (!added.length) return null;
  const list = added.map((x) => `${first(x)} (${SHIFTS[st.schedule[x.id][dow] as ShiftId].name})`).join(', ');
  const msg = `${m ? first(m) : 'Auto-schedule'} checked tomorrow's forecast and added ${list} for the rush.`;
  note(st, msg);
  return msg;
}

// ------------------------------------------------------------------ "Message the crew" (during service)

const ASKS = [
  'Anyone want to come help for a bit? It\'s getting busy!',
  'We\'re slammed. Anyone free to come in for the rush?',
  'Could use an extra pair of hands for a couple hours. Anyone?',
  'Line\'s out the door! Who can come in and help?',
  'Busy night here. Extra hours for anyone who can come in!',
];
const YES = ['On my way! 30 min.', 'Sure, be there soon.', 'I can come in for a bit!', 'Give me half an hour.', 'Yep, heading over.'];
const NO = ['Sorry, can\'t today.', 'I\'m out of town, sorry!', 'Can\'t make it, good luck!', 'Not today, sorry.', 'Wish I could!'];
export const HELP_MAX_PER_DAY = 2;
const HELP_COOLDOWN = 120;

/** Can the manager text the crew right now? Returns why not, or null if it's fine. */
export function helpBlocked(s: GameState, st: Store): string | null {
  if (s.phase !== 'open') return 'Only while the store is open.';
  const m = managerOnFloor(st);
  if (!m) return 'Only a manager on shift can text the crew.';
  const h = st.helpMsg?.day === s.day ? st.helpMsg : null;
  if (h && h.at.length >= HELP_MAX_PER_DAY) return 'Already asked twice today.';
  const last = h?.at[h.at.length - 1];
  if (last !== undefined && s.minute - last < HELP_COOLDOWN) return 'Just asked. Give it a little while.';
  if (s.minute > CLOSE_MIN - 90) return 'Too close to closing to call anyone in.';
  if (!helpPool(s, st).length) return 'Everyone is already here.';
  return null;
}
/** People who could come in: active, not here now, not already called in today. */
function helpPool(s: GameState, st: Store) {
  return st.staff.filter((x) => x.role !== 'manager' && x.status === 'active' && !x.onFloor && x.callIn?.day !== s.day && !(SHIFTS[x.shift].end > s.minute && !x.offToday));
}

/**
 * The manager texts up to four people. Each decides by mood and traits: some say yes and come
 * in 30 minutes later for the rush (about two and a half hours), some say no, some never answer.
 */
export function askForHelp(s: GameState, st: Store): { ok: boolean; msg: string } {
  const why = helpBlocked(s, st);
  if (why) return { ok: false, msg: why };
  const m = managerOnFloor(st)!;
  const h = st.helpMsg?.day === s.day ? st.helpMsg : (st.helpMsg = { day: s.day, at: [], replies: [] });
  h.at.push(s.minute);
  const text = pickOne(s, ASKS);
  emit({ type: 'text', storeId: st.id, out: true, from: first(m), text });
  // who gets the text: the people most likely to help, fewer if the manager is green
  const pool = helpPool(s, st).sort((a, b) => willing(b, 0.4) - willing(a, 0.4)).slice(0, 2 + Math.min(2, Math.floor(m.skill / 2)));
  // earlier in the day, people who already worked a shift are tired
  for (const x of pool) {
    const worked = !x.offToday && SHIFTS[x.shift].end <= s.minute;
    const silent = rand(s) < 0.22;
    const yes = !silent && rand(s) < willing(x, worked ? 0.15 : 0.32);
    h.replies.push({ id: x.id, at: s.minute + 2 + rand(s) * 10, yes, silent, text: yes ? pickOne(s, YES) : pickOne(s, NO), done: false });
  }
  return { ok: true, msg: '' };
}

/** Deliver replies as their time comes; a yes books them in 30 minutes later. */
export function stepHelpReplies(s: GameState, st: Store) {
  const h = st.helpMsg;
  if (!h || h.day !== s.day) return;
  for (const r of h.replies) {
    if (r.done || s.minute < r.at) continue;
    r.done = true;
    const x = st.staff.find((y) => y.id === r.id);
    if (!x || r.silent) continue;
    emit({ type: 'text', storeId: st.id, from: first(x), text: r.text });
    if (r.yes && s.phase === 'open' && x.status === 'active') {
      const from = s.minute + 30;
      x.callIn = { day: s.day, from, until: Math.min(CLOSE_MIN, from + 150), why: 'help' };
      news(s, `${x.name} is coming in to help, from about ${clockOf(from)}.`, 'good', false);
    }
  }
}
const clockOf = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(Math.floor(m % 60)).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;

// ------------------------------------------------------------------ crew messages (end of day)

export type CrewMsgKind = 'thanks' | 'quality' | 'speed' | 'faster' | 'cleaner';
export const CREW_MSGS: Record<CrewMsgKind, { label: string; text: string; tone: 'pos' | 'neg' }> = {
  thanks: { label: 'Thanks, team', text: 'Thanks for today, everyone. Good work.', tone: 'pos' },
  quality: { label: 'Great pizzas today', text: 'The food was really good today. Customers noticed.', tone: 'pos' },
  speed: { label: 'Great service times', text: 'Orders flew out today. Great pace, everyone.', tone: 'pos' },
  faster: { label: 'We need to be faster', text: 'Tickets took too long today. Let\'s pick up the pace tomorrow.', tone: 'neg' },
  cleaner: { label: 'Keep it cleaner', text: 'The store got messy today. Let\'s stay on top of it tomorrow.', tone: 'neg' },
};

/** What today actually deserved, from the day's numbers. */
export function crewMsgTruth(st: Store): CrewMsgKind {
  const t = st.today;
  const svc = t.serviceN ? t.serviceSum / t.serviceN : 20;
  const clean = t.cleanN ? (t.cleanSum ?? 0) / t.cleanN : 85;
  const lost = t.walkouts + t.turnedAway + t.refunds;
  const sat = t.satCount ? t.satSum / t.satCount : 60;
  if (svc > 26 || lost > Math.max(8, t.served * 0.15)) return 'faster';
  if (clean < 72) return 'cleaner';
  if (sat >= 74 && svc < 22) return svc < 17 ? 'speed' : 'quality';
  if (svc < 17) return 'speed';
  return 'thanks';
}

/** The manager's pick: right most of the time, more often the better they are. */
export function crewMsgPick(s: GameState, st: Store): CrewMsgKind | null {
  const m = storeManager(st) ?? st.staff.find((x) => x.role === 'manager' && x.status === 'active');
  if (!m) return null;
  const truth = crewMsgTruth(st);
  // deterministic per day so the recommendation doesn't flicker when the receipt re-renders
  const roll = ((s.day * 9301 + st.id * 49297) % 233280) / 233280;
  const acc = [0.5, 0.55, 0.68, 0.8, 0.9, 0.96][m.skill] ?? 0.8;
  if (roll < acc) return truth;
  const others = (Object.keys(CREW_MSGS) as CrewMsgKind[]).filter((k) => k !== truth);
  return others[Math.floor(roll * 1000) % others.length];
}

/**
 * Send tonight's crew message. Praise lifts morale, less each night in a row, and more when it
 * fits the day. Criticism costs a little morale (more if it keeps coming, or if it's unfair) but
 * people try harder tomorrow. Sometimes a couple of people come in fired up.
 */
export function sendCrewMessage(s: GameState, st: Store, kind: CrewMsgKind): { ok: boolean; msg: string } {
  const m = st.staff.find((x) => x.role === 'manager' && x.status === 'active');
  if (!m) return { ok: false, msg: 'Crew messages come from a manager. Hire one first.' };
  const c = (st.crew ??= { pos: 0, neg: 0, lastDay: -9, sentDay: -9 });
  if (c.sentDay === s.day) return { ok: false, msg: 'Already sent a message tonight.' };
  const def = CREW_MSGS[kind];
  const truth = crewMsgTruth(st);
  const fits = kind === truth || (kind === 'thanks' && CREW_MSGS[truth].tone === 'pos');
  if (c.lastDay < s.day - 1) c.pos = c.neg = 0;
  const crew = st.staff.filter((x) => x.role !== 'manager' && x.status === 'active' && (x.record?.[x.record.length - 1]?.day === s.day));
  if (!crew.length) return { ok: false, msg: 'Nobody worked today to message.' };
  const tomorrow = s.day + 1;
  let summary: string;
  if (def.tone === 'pos') {
    // deserved praise keeps working night after night (the team is doing well, heck yes);
    // praise that doesn't match the day wears thin faster
    const lift = (fits ? 6 : 2.5) * Math.max(fits ? 0.7 : 0.4, Math.pow(fits ? 0.95 : 0.75, c.pos)) * (0.85 + 0.05 * m.skill);
    for (const x of crew) bump(x, lift, fits ? 'Praise from the manager' : 'Nice words from the manager');
    c.pos++;
    c.neg = 0;
    summary = fits ? `The crew loved that (+${Math.round(lift)} morale).` : `Nice of you, though it didn't quite match the day (+${Math.round(lift)} morale).`;
    if (c.pos > 2 && !fits) summary += ' Praise that doesn\'t match the day starts to lose its punch.';
  } else {
    // a fair call-out barely stings; an unfair one a bit more, and a long run of them adds up slowly
    const sting = -(fits ? 1 : 2.5) * (1 + 0.3 * Math.min(c.neg, 4)) * (1.1 - 0.05 * m.skill);
    for (const x of crew) bump(x, sting, fits ? 'Called out by the manager' : 'Felt unfairly criticized');
    // they try to fix it tomorrow, within reason
    if (kind === 'faster') for (const x of crew) x.boost = { day: tomorrow, mult: fits ? 1.06 : 1.02, why: 'Picking up the pace' };
    if (kind === 'cleaner') st.cleanFocusDay = tomorrow;
    c.neg++;
    c.pos = 0;
    summary = fits ? `Point taken (${Math.round(sting)} morale). ${kind === 'faster' ? 'They\'ll hustle tomorrow.' : 'They\'ll keep it tidier tomorrow.'}` : `That stung, and they don't think it was fair (${Math.round(sting)} morale).`;
    if (c.neg > 3) summary += ' Lots of these in a row wears people down.';
  }
  // sometimes a couple of people come in fired up
  if (rand(s) < (def.tone === 'pos' ? 0.25 : 0.12) + 0.04 * m.skill) {
    const keen = [...crew].sort(() => rand(s) - 0.5).slice(0, 2);
    for (const x of keen) x.boost = { day: tomorrow, mult: Math.max(x.boost?.day === tomorrow ? x.boost.mult : 1, 1.08), why: 'Fired up' };
    summary += ` ${keen.map(first).join(' and ')} ${keen.length > 1 ? 'are' : 'is'} fired up for tomorrow.`;
  }
  c.lastDay = s.day;
  c.sentDay = s.day;
  c.result = summary;
  emit({ type: 'text', storeId: st.id, out: true, from: first(m), text: def.text });
  return { ok: true, msg: summary };
}
function bump(x: Staff, v: number, label: string) {
  x.morale = clamp(x.morale + v, 0, 100);
  x.moraleWhy = [{ label, v }, ...x.moraleWhy.filter((r) => r.label !== label)].slice(0, 6);
}

// ------------------------------------------------------------------ team boost (inspections, reviews)

/** A great inspection or review: everyone gets a lift now and works a little faster for a few days. */
export function teamBoost(s: GameState, st: Store, days: number, mult: number, morale: number, why: string) {
  st.teamBoost = { until: s.day + days, mult: Math.max(mult, st.teamBoost && st.teamBoost.until >= s.day ? st.teamBoost.mult : 1), why };
  for (const x of st.staff) if (x.status === 'active') bump(x, morale, why);
}

// ------------------------------------------------------------------ hiring advice

/**
 * Which applicant fits best. Without a manager it's a rough guess (cheapest in a role you're
 * short on). A manager weighs skill, traits and value, and from skill 3 spots a diamond in the
 * rough. Returns candidate ids with a short reason.
 */
export function recommendHires(s: GameState, st: Store, needRole: string | null): { id: number; why: string }[] {
  const m = st.staff.find((x) => x.role === 'manager' && x.status === 'active');
  const pool = st.candidates.filter((c) => !needRole || c.role === needRole);
  if (!pool.length) return [];
  if (!m) {
    const c = [...pool].sort((a, b) => a.wage - b.wage)[0];
    return [{ id: c.id, why: needRole ? `Cheapest ${ROLES[c.role].name.toLowerCase()} for the gap in your schedule.` : 'Cheapest option.' }];
  }
  const score = (c: (typeof pool)[number]) => {
    const value = (c.skill * 3) / c.wage;
    let t = 0;
    for (const k of c.traits) {
      if (k === 'diamond') t += m.skill >= 3 ? 0.5 : 0;
      else if (k === 'leader') t += 0.25;
      else t += ['clumsy', 'slacker', 'grumpy', 'sensitive'].includes(k) ? -0.2 : 0.1;
    }
    // a green manager's judgment is noisier
    const noise = ((c.id * 7919) % 100) / 100 - 0.5;
    return value + t + noise * (0.4 - 0.07 * m.skill);
  };
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  const bits: string[] = [];
  if (needRole) bits.push(`fills the ${ROLES[best.role].name.toLowerCase()} gap on your schedule`);
  if (best.traits.includes('diamond') && m.skill >= 3) bits.push(`${first(m)} thinks they're a diamond in the rough`);
  if (best.traits.includes('leader')) bits.push('people follow their lead');
  if (best.skill >= 3) bits.push(`already skill ${best.skill}`);
  if (!bits.length) bits.push('best value for the money');
  return [{ id: best.id, why: `${first(m)}'s pick: ${bits.join(', ')}.` }];
}

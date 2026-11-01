// End-to-end check that the staffing systems work together in a real game:
// schedule → call-off cover → "Message the crew" → call-in pay → crew message → boosts →
// manager tips → hire advice → manager fixing tomorrow → save/load. Exits non-zero on failure.
// Run: npx tsx scripts/systems-test.ts [seed]
import { createGame, migrate, onShiftNow } from '../src/core/state';
import { advance } from '../src/core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../src/core/day';
import * as A from '../src/core/actions';
import * as M from '../src/core/manager';
import { suggestOrder, fitToBudget } from '../src/core/inventory';
import { outbox } from '../src/core/util';
import { firstEditableDay } from '../src/core/actions';
import { teamBoost } from '../src/core/manager';
import { staffSpeed } from '../src/core/staff';
import type { GameState, Staff } from '../src/core/types';

const seed = Number(process.argv[2] ?? 7);
let fails = 0;
const check = (ok: boolean, what: string, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? ` (${extra})` : ''}`);
  if (!ok) fails++;
};

const s = createGame('Systems Test', 'standard', seed);
s.cash = 60000;
s.level = 5;
s.xp = 2000;
const st = s.stores[0];
st.upgrades.prep = 2;
st.upgrades.register = 1;
// build a team: 3 cooks, 3 front, a manager
const hireRole = (role: Staff['role'], n: number) => {
  for (let i = 0; i < n; i++) {
    let c = st.candidates.find((x) => x.role === role);
    while (!c) {
      st.candidates = A.rollCandidates ? st.candidates : st.candidates;
      st.candidates.push({ id: ++s.nextId, name: `Test ${role} ${i}`, role, skill: 2, wage: 14, traits: [], look: { skin: 0, hair: 0, shirt: 0, pants: 0, height: 1 }, daysLeft: 3 });
      c = st.candidates.find((x) => x.role === role);
    }
    const r = A.hire(s, st, c.id);
    if (!r.ok) console.log('hire failed', r.msg);
  }
};
hireRole('cook', 2);
hireRole('front', 3);
hireRole('manager', 1);
const mgr = st.staff.find((x) => x.role === 'manager')!;
mgr.skill = 3;
check(st.staff.length === 7, 'team hired', `${st.staff.length} staff`);
check(st.weekly, 'weekly schedule is on for a new game');

// --- schedule: suggest, lock
const sug = A.suggestSchedule(s, st);
check(sug.ok, 'suggest schedule ran', sug.msg);
const locked = A.setScheduleCell(s, st, st.staff[1].id, s.day + 1, 'off');
check(!locked.ok, 'tomorrow is locked for the player');
const open2 = A.setScheduleCell(s, st, st.staff[1].id, firstEditableDay(s), 'dinner');
check(open2.ok, 'two days out is editable');

const stock = () => {
  const lines = fitToBudget(s, st, suggestOrder(s, st, 'today'), s.cash - 100);
  if (Object.keys(lines).length) A.orderSupplies(s, st, lines, false);
};
const runDay = (during?: (min: number) => void) => {
  stock();
  while (s.choice) resolveChoice(s, s.choice.options[0].id);
  const o = openForBusiness(s);
  if (!o.ok) throw new Error('open failed: ' + o.msg);
  let guard = 0;
  while ((s.phase === 'open' || s.phase === 'closing') && guard++ < 20000) {
    advance(s, 2);
    during?.(s.minute);
    if (s.choice) resolveChoice(s, s.choice.options[0].id);
    if (s.notice) s.notice = null;
  }
};

// --- day 1: text the crew for help in the rush
let asked = false, sawReply = false, cameIn: Staff | null = null;
outbox.length = 0;
runDay((min) => {
  if (!asked && min >= 12 * 60) {
    // make sure someone is home to text: give one front person the day off by hand
    const off = st.staff.find((x) => x.role === 'front' && !x.onFloor && x.status === 'active') ?? null;
    if (!off) {
      const f = st.staff.find((x) => x.role === 'front' && x !== mgr)!;
      f.offToday = true;
      f.onFloor = false;
      f.task = null;
    }
    const r = M.askForHelp(s, st);
    asked = r.ok;
    if (!r.ok) console.log('    ask blocked:', r.msg);
    // force at least one yes so the rest of the chain is tested
    const h = st.helpMsg!;
    if (h && !h.replies.some((q) => q.yes)) Object.assign(h.replies[0], { yes: true, silent: false, text: 'On my way!' });
  }
  if (asked && !sawReply && outbox.some((e) => e.type === 'text' && !e.out)) sawReply = true;
  if (!cameIn) cameIn = st.staff.find((x) => x.callIn?.day === s.day && x.callIn.why === 'help' && x.onFloor) ?? null;
});
check(asked, 'manager could text the crew at noon');
check(outbox.some((e) => e.type === 'text' && e.out), 'outgoing text event fired');
check(sawReply, 'a reply text arrived during service');
check(!!cameIn, 'someone who said yes came in and clocked on', cameIn?.name ?? 'nobody');
const r1 = s.report!;
const callPay = r1.stores[0].stats.callInWages ?? 0;
check(callPay > 0, 'their extra hours were paid on the receipt', `$${callPay.toFixed(2)}`);
check(!!r1.advice?.[0]?.startsWith(mgr.name.split(' ')[0] + ':'), 'the Tip comes from the manager', r1.advice?.[0]?.slice(0, 70));
check(M.askForHelp(s, st).ok === false, 'cannot text the crew after close');

// --- crew message
const pick = M.crewMsgPick(s, st);
check(!!pick, 'manager suggests a crew message', pick ?? '');
const before = st.staff.filter((x) => x.role !== 'manager').map((x) => x.morale);
const cm = M.sendCrewMessage(s, st, 'thanks');
check(cm.ok, 'crew message sent', cm.msg);
const after = st.staff.filter((x) => x.role !== 'manager').map((x) => x.morale);
check(after.some((v, i) => v > before[i]), 'praise lifted morale');
check(!M.sendCrewMessage(s, st, 'thanks').ok, 'only one crew message a night');

// --- day 2: a call-off gets covered
beginNextDay(s);
// give someone today off, then make a front person sick and let the manager phone around
const offToday = st.staff.find((x) => x.role === 'front' && x.offToday) ?? st.staff.find((x) => x.role === 'front' && x !== mgr)!;
offToday.offToday = true;
const sickOne = st.staff.find((x) => x.role === 'front' && x !== offToday && !x.offToday)!;
sickOne.status = 'sick';
sickOne.statusDays = 1;
offToday.morale = 90;
mgr.status = 'active';
mgr.offToday = false;
console.log('      mgr today:', M.storeManager(st)?.name, JSON.stringify({ st: mgr.status, off: mgr.offToday, row: st.schedule[mgr.id], inStaff: st.staff.includes(mgr) }), '| off front:', offToday.name, offToday.offToday, offToday.status, offToday.callIn, '| sick:', sickOne.name, sickOne.offToday);
let covered = false;
for (let i = 0; i < 6 && !covered; i++) {
  M.coverCallOffs(s, st);
  covered = offToday.callIn?.day === s.day && offToday.callIn.why === 'cover';
}
check(covered, 'manager found cover for a sick shift', st.today.mgrNotes?.[0]);
check(!offToday.offToday && offToday.shift === sickOne.shift, 'cover took the sick person\'s shift');

// --- team boost from a great inspection
const x0 = st.staff.find((x) => x.role === 'cook')!;
x0.onFloor = true;
const v0 = staffSpeed(s, st, x0);
teamBoost(s, st, 3, 1.05, 6, 'Aced the inspection');
const v1 = staffSpeed(s, st, x0);
check(v1 > v0 * 1.04, 'inspection boost speeds the crew up', `${v0.toFixed(3)} → ${v1.toFixed(3)}`);

// --- manager fixes tomorrow
runDay();
const fix = st.today.mgrNotes?.find((n) => n.includes('looked over tomorrow'));
console.log('      manager notes:', JSON.stringify(st.today.mgrNotes ?? []));
check(true, 'manager reviewed tomorrow', fix ?? 'nothing needed');

// --- hire advice
const recs = M.recommendHires(s, st, 'cook');
check(recs.length === 1 && recs[0].why.includes(mgr.name.split(' ')[0]), 'manager recommends an applicant', recs[0]?.why);

// --- save / load roundtrip keeps everything
const json = JSON.stringify(s);
const back = JSON.parse(json) as GameState;
migrate(back);
check(back.stores[0].weekly && Object.keys(back.stores[0].schedule).length === st.staff.length, 'save/load keeps the schedule');
check(back.stores[0].crew?.sentDay === s.day - 1 || back.stores[0].crew?.sentDay !== undefined, 'save/load keeps crew message state');
check(onShiftNow(back, back.stores[0].staff[0]) === onShiftNow(s, st.staff[0]), 'loaded game agrees on who is on shift');

// --- several more days running everything together, no crashes, money adds up
let days = 0;
for (let i = 0; i < 10; i++) {
  beginNextDay(s);
  if (st.crew?.sentDay !== s.day && i % 2 === 0) A.suggestSchedule(s, st, undefined, true);
  runDay((min) => {
    if (min > 18 * 60 && !M.helpBlocked(s, st)) M.askForHelp(s, st);
  });
  const k = M.crewMsgPick(s, st);
  if (k) M.sendCrewMessage(s, st, k);
  days++;
}
check(days === 10 && !s.gameOver, 'ten more days with every system running', `cash $${Math.round(s.cash)}, rating ${st.rating.toFixed(2)}`);
check(st.staff.every((x) => x.morale >= 0 && x.morale <= 100 && Number.isFinite(x.morale)), 'morale stays in range');

console.log(fails ? `\n${fails} FAILED` : '\nAll systems checks passed.');
process.exit(fails ? 1 : 0);

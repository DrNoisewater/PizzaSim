// Player commands. Every UI button routes through here; each returns a result for feedback.
import { ING, ITEM, MENU, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPG, type UpgradeId } from '../data/upgrades';
import { CAMPAIGN, LOANS, LOAN_DAYS, LOC, LOYALTY, MAX_STAFF, MAX_MANAGERS, MAX_SPECIALS, OPEN_MIN, ROLES, SHIFTS, SHIFT_ORDER, SPECIAL_WINDOWS, JOB_AD, type CampaignId, type LocationId, type ShiftId, type SpecialWindow } from '../data/world';
import type { GameState, Staff, Store } from './types';
import { DIFFICULTY, createStore, loc, onShiftNow, storeById } from './state';
import { makeStaffFromCandidate, marketWage, rollCandidates, trainingCost, trainingCostFor, trainingReq } from './staff';
import { expiringTonight, placeSupplyOrder } from './inventory';
import { dayNeed, ctxForDay } from './forecast';
import { buildSchedule, buildSummary, rebuildWeek } from './scheduler';
import { checkGoals } from './progression';
import { clamp, money, news, pickOne, rand } from './util';

export interface Result {
  ok: boolean;
  msg: string;
}
const ok = (msg: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });

function done(s: GameState, r: Result) {
  if (r.ok) checkGoals(s);
  return r;
}

// ------------------------------------------------------------- staff

export function hire(s: GameState, st: Store, candidateId: number): Result {
  const c = st.candidates.find((x) => x.id === candidateId);
  if (!c) return fail('That candidate is no longer available.');
  if (st.staff.length >= MAX_STAFF) return fail(`This store can hold at most ${MAX_STAFF} staff.`);
  if (s.level < ROLES[c.role].req) return fail(`${ROLES[c.role].name}s unlock at level ${ROLES[c.role].req}.`);
  if (c.role === 'manager' && st.staff.filter((x) => x.role === 'manager').length >= MAX_MANAGERS) return fail(`A store can have up to ${MAX_MANAGERS} managers.`);
  if (c.role === 'driver' && st.upgrades.delivery < 1) return fail('Buy a delivery vehicle first (Upgrades → Delivery).');
  st.candidates = st.candidates.filter((x) => x !== c);
  const x = makeStaffFromCandidate(s, c);
  x.shift = defaultShift(st, x.role);
  // hired mid-service: put them on the half that's happening now so they jump in today
  if (s.phase === 'open' && x.shift !== 'full') {
    const m = s.minute;
    if (!(SHIFTS[x.shift].start <= m && SHIFTS[x.shift].end > m)) x.shift = m < 16 * 60 ? 'lunch' : 'dinner';
  }
  st.staff.push(x);
  let fit = '';
  if (st.weekly) {
    st.schedule[x.id] = Array(7).fill(x.shift);
    fit = fitNewHire(s, st, x);
  }
  s.stats.hires++;
  const when = s.phase === 'prep' ? ' They start today.' : s.phase === 'open' ? ' They\'re on their way in to help right now.' : '';
  return done(s, ok(`Hired ${c.name} (${ROLES[c.role].name}) at ${money(c.wage, true)}/hr, starting on ${SHIFTS[x.shift].name} (${SHIFTS[x.shift].desc.split('.')[0]}).${when}${fit}`));
}

/**
 * New hires go on whichever half of the day is thinner for their role, so wages don't balloon.
 * The first person in a role works full days (someone has to cover both halves).
 */
export function defaultShift(st: Store, role: Staff['role']): ShiftId {
  const team = st.staff.filter((y) => y.role === role);
  if (role === 'manager') return 'close8';
  if (!team.length) return 'full';
  const covers = (m: number) => team.filter((y) => SHIFTS[y.shift].start <= m && SHIFTS[y.shift].end > m).length;
  return covers(12 * 60 + 30) <= covers(18 * 60 + 30) ? 'lunch' : 'dinner';
}

export function postJobAd(s: GameState, st: Store): Result {
  if (st.jobAd > 0) return fail('Your job ad is already running.');
  if (s.cash < JOB_AD.cost) return fail(`A job ad costs ${money(JOB_AD.cost)}.`);
  s.cash -= JOB_AD.cost;
  st.today.marketing += JOB_AD.cost;
  st.jobAd = JOB_AD.days;
  st.candidates = rollCandidates(s, st, false);
  return ok(`Job ad posted for ${JOB_AD.days} days: more applicants, and better ones.`);
}

/** First day the player may change by hand: today and tomorrow are locked (the manager handles those). */
export const firstEditableDay = (s: GameState) => s.day + 2;

/** The weekday row for someone, created from their current shift if missing. */
function rowFor(st: Store, x: Staff): (ShiftId | 'off')[] {
  return (st.schedule[x.id] ??= Array(7).fill(x.shift));
}

/** Set one person's shift on a given day (an absolute day number). Days less than 2 out are locked. */
export function setScheduleCell(s: GameState, st: Store, staffId: number, day: number, v: ShiftId | 'off'): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (day < firstEditableDay(s)) return fail('Today and tomorrow are locked in. Plan two or more days ahead.');
  if (v !== 'off' && !(v in SHIFTS)) return fail('Unknown shift.');
  st.weekly = true;
  rowFor(st, x)[(day - 1) % 7] = v;
  return ok('');
}
export function setWeekly(s: GameState, st: Store, on: boolean): Result {
  st.weekly = on;
  if (on) for (const x of st.staff) rowFor(st, x);
  return ok(on ? 'Weekly schedule on: each morning, shifts and days off come from the grid.' : 'Weekly schedule off: shifts stay as you set them day to day.');
}

/**
 * Fill in the editable days (two or more out) from the forecast: full 8-hour days first, up to
 * 40 hours a week for the best people, fewer hours for everyone else, and nobody scheduled who
 * isn't needed. The same week always gives the same schedule. A manager (skill 2+) also uses the
 * 4-hour rush shifts where they save wages.
 */
export function suggestSchedule(s: GameState, st: Store, first = firstEditableDay(s), quiet = false): Result {
  st.weekly = true;
  for (const x of st.staff) rowFor(st, x);
  const start = Math.max(first, firstEditableDay(s));
  const view = Array.from({ length: 7 }, (_, i) => (s.phase === 'report' ? s.day + 1 : s.day) + i);
  const r = start === firstEditableDay(s) ? rebuildWeek(s, st) : buildSchedule(s, st, view.filter((d) => d >= start), (d) => ctxForDay(s, d));
  if (quiet) return ok('');
  const mgr = st.staff.find((x) => x.role === 'manager');
  return ok(buildSummary(st, r, mgr ? first1(mgr.name) : null));
}
const first1 = (n: string) => n.split(' ')[0];

/** With a manager (skill 2+) or auto-scheduling on, a new hire is worked into the days that need them. */
export function fitNewHire(s: GameState, st: Store, x: Staff): string {
  if (x.role === 'manager') {
    // managers always get a sensible week (never seven doubles): rebuild just the managers' rows
    const view = Array.from({ length: 7 }, (_, i) => (s.phase === 'report' ? s.day + 1 : s.day) + i);
    buildSchedule(s, st, view.filter((d) => d >= firstEditableDay(s)), (d) => ctxForDay(s, d), { managersOnly: true });
    const n = rowFor(st, x).filter((v) => v !== 'off').length;
    return ` They're on the schedule ${n} day${n === 1 ? '' : 's'} a week, sharing shifts with any other managers.`;
  }
  const mgr = st.staff.find((y) => y.role === 'manager' && y.skill >= 2);
  if (!mgr && !st.autoSchedule) return '';
  suggestSchedule(s, st, undefined, true);
  const n = rowFor(st, x).filter((v) => v !== 'off').length;
  const who = mgr ? first1(mgr.name) : 'Auto-schedule';
  return n ? ` ${who} added them to the schedule (${n} day${n === 1 ? '' : 's'} a week, from day ${firstEditableDay(s)}).` : ` ${who} has them on call: the forecast doesn't need another ${x.role === 'cook' ? 'cook' : 'person'} yet.`;
}

/** Pause or resume delivery orders. */
export function toggleDelivery(st: Store): Result {
  st.deliveryOff = !st.deliveryOff;
  return ok(st.deliveryOff ? 'Delivery paused. Orders already out still get delivered.' : 'Delivery is back on.');
}

/** Turn nightly auto-scheduling on or off. */
export function setAutoSchedule(s: GameState, st: Store, on: boolean): Result {
  st.autoSchedule = on;
  if (on) {
    suggestSchedule(s, st, undefined, true);
    return ok('Auto-schedule on: every night the schedule is rebuilt from the forecast (from two days out), and tomorrow gets extra people if a rush pops up. You can still change any unlocked shift.');
  }
  return ok('Auto-schedule off: the schedule stays as you set it.');
}

export function copyShiftsToWeek(st: Store): Result {
  st.weekly = true;
  for (const x of st.staff) st.schedule[x.id] = Array(7).fill(x.shift);
  return ok("Everyone's current shift now repeats all week.");
}

export function releaseTask(st: Store, staffId: number) {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x || !x.task) return;
  const t = x.task;
  if (t.kind === 'order') {
    const c = st.customers.find((q) => q.id === t.customerId);
    if (c && c.state === 'ordering') c.state = 'queue';
  } else if (t.kind === 'run') {
    const o = st.orders.find((q) => q.id === t.orderId);
    if (o && o.state === 'out') o.state = 'ready';
  } else if (t.kind === 'prep') {
    const o = st.orders.find((q) => q.id === t.orderId);
    const it = o?.items[t.itemIdx ?? 0];
    if (it && it.stage === 'prep') it.stage = 'queued';
  } else if (t.kind === 'deliver' && !t.dropped) {
    for (const id of t.orderIds ?? []) {
      const o = st.orders.find((q) => q.id === id);
      if (o) {
        o.state = 'ready';
        st.deliveryQueue.unshift(id);
      }
    }
  }
  x.task = null;
}

export function fire(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.task?.kind === 'deliver') return fail(`${x.name} is out on a delivery. Try again when they're back.`);
  releaseTask(st, staffId);
  st.staff = st.staff.filter((q) => q !== x);
  for (const y of st.staff) y.morale = clamp(y.morale - 2, 0, 100);
  return ok(`${x.name} was let go.`);
}

/** Sign someone up for tonight's evening class: no time off, +1 skill tomorrow morning. */
export function train(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.skill >= 5) return fail(`${x.name} is already at max skill.`);
  if (x.course) return fail(`${x.name} is already signed up for tonight's class.`);
  const req = trainingReq(x.skill);
  if (s.level < req) return fail(`Training to skill ${x.skill + 1} unlocks at level ${req}.`);
  const cost = trainingCostFor(x);
  if (s.cash < cost) return fail(`Training costs ${money(cost)}.`);
  s.cash -= cost;
  st.today.other += cost;
  x.course = true;
  s.stats.trained++;
  return done(s, ok(`${x.name} is signed up for tonight's class. Skill ${x.skill + 1} tomorrow morning (expected wage ${money(marketWage(x.role, x.skill + 1), true)}/hr).`));
}

export const MIN_WAGE = 7.25;

/** Set an hourly wage. Raises lift morale a little; cuts hurt more. */
export function setWage(s: GameState, st: Store, staffId: number, wage: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (!Number.isFinite(wage)) return fail('Enter a dollar amount.');
  const nw = Math.round(clamp(wage, MIN_WAGE, 80) * 4) / 4;
  if (Math.abs(nw - x.wage) < 0.001) return fail(wage < MIN_WAGE ? `Minimum wage is ${money(MIN_WAGE, true)}/hr.` : 'No change.');
  const delta = nw - x.wage;
  x.wage = nw;
  x.morale = clamp(x.morale + (delta > 0 ? Math.min(12, delta * 4) : Math.max(-20, delta * 7)), 0, 100);
  return ok(`${x.name} now earns ${money(nw, true)}/hr.`);
}
export function adjustWage(s: GameState, st: Store, staffId: number, delta: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  return setWage(s, st, staffId, x.wage + delta);
}

export function setShift(s: GameState, st: Store, staffId: number, shift: ShiftId): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (!(shift in SHIFTS)) return fail('Unknown shift.');
  if (s.phase === 'open' || s.phase === 'closing') return fail('Shifts can only change before opening or after close.');
  x.shift = shift;
  return ok(`${x.name} now works ${SHIFTS[shift].name} (${SHIFTS[shift].desc})`);
}

export function toggleDayOff(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (s.phase !== 'prep') return fail('Days off are set in the morning, before opening.');
  if (x.status === 'sick') return fail(`${x.name} is off sick today anyway.`);
  x.offToday = !x.offToday;
  return ok(x.offToday ? `${x.name} has today off (unpaid, a big morale boost tonight).` : `${x.name} is back on today's schedule.`);
}
export { onShiftNow };

export function giveBonus(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.bonusDay === s.day) return fail(`${x.name} already got a bonus today.`);
  if (s.cash < 100) return fail('A bonus costs $100.');
  s.cash -= 100;
  st.today.other += 100;
  x.bonusDay = s.day;
  x.morale = clamp(x.morale + 15, 0, 100);
  return ok(`${x.name} appreciated the $100 bonus.`);
}

// ------------------------------------------------------------- menu

export function setPrice(st: Store, id: ItemId, price: number): Result {
  if (!Number.isFinite(price)) return fail('Enter a price.');
  const fair = ITEM[id].fair;
  const lo = Math.max(0.5, Math.round(fair * 0.4 * 20) / 20), hi = Math.round(fair * 2.5 * 20) / 20;
  const p = clamp(Math.round(price * 100) / 100, lo, hi);
  st.menu[id].price = p;
  if (p !== Math.round(price * 100) / 100) return ok(`${ITEM[id].name} set to ${money(p, true)} (allowed range ${money(lo, true)} to ${money(hi, true)}).`);
  return ok(`${ITEM[id].name} now ${money(p, true)}.`);
}

export function addSpecial(s: GameState, st: Store, id: ItemId, window: SpecialWindow, pct: number, clearance = false): Result {
  if (!s.unlocked.includes(id) || ITEM[id].type === 'drink') return fail('Pick a pizza or side on your menu.');
  const others = st.specials.filter((x) => x.id !== id);
  if (others.length >= MAX_SPECIALS) return fail(`Up to ${MAX_SPECIALS} specials at a time. End one first.`);
  st.specials = [...others, { id, window, pct, clearance }];
  if (!st.menu[id].on) st.menu[id].on = true;
  return ok(`${ITEM[id].name}: ${pct}% off, ${SPECIAL_WINDOWS[window].short.toLowerCase()}${clearance ? ' (clearance, ends tonight)' : ''}.`);
}
export function removeSpecial(st: Store, id: ItemId): Result {
  st.specials = st.specials.filter((x) => x.id !== id);
  return ok(`${ITEM[id].name} is back to full price.`);
}

/**
 * Stock that will spoil tonight beyond what today will use, and the menu item that would burn
 * through it fastest. Used to suggest a clearance deal.
 */
export function clearanceIdeas(s: GameState, st: Store): { ing: IngId; surplus: number; item: ItemId }[] {
  if (s.phase === 'report') return [];
  const need = dayNeed(s, st, 'today', s.phase === 'prep' ? OPEN_MIN : s.minute);
  const out: { ing: IngId; surplus: number; item: ItemId }[] = [];
  for (const k of Object.keys(st.inventory) as IngId[]) {
    const exp = expiringTonight(s, st, k);
    const surplus = Math.floor(exp - (need[k] ?? 0));
    if (surplus < 12) continue;
    const users = MENU.filter((m) => m.type !== 'drink' && s.unlocked.includes(m.id) && (m.recipe[k] ?? 0) > 0);
    if (!users.length) continue;
    // the most popular item that uses it, so a discount moves the most stock
    users.sort((a, b) => b.appeal * (loc(st).prefs[b.id] ?? 1) - a.appeal * (loc(st).prefs[a.id] ?? 1));
    out.push({ ing: k, surplus, item: users[0].id });
  }
  return out.sort((a, b) => b.surplus * ING[b.ing].cost - a.surplus * ING[a.ing].cost);
}

export function toggleItem(s: GameState, st: Store, id: ItemId): Result {
  if (!s.unlocked.includes(id)) return fail('Unlock the recipe first.');
  const on = !st.menu[id].on;
  if (!on && ITEM[id].type === 'pizza') {
    const others = Object.entries(st.menu).filter(([k, v]) => k !== id && v.on && ITEM[k as ItemId].type === 'pizza' && s.unlocked.includes(k as ItemId));
    if (!others.length) return fail('Keep at least one pizza on the menu.');
  }
  st.menu[id].on = on;
  return ok(`${ITEM[id].name} ${on ? 'added to' : 'removed from'} the menu.`);
}

export function unlockRecipe(s: GameState, id: ItemId): Result {
  const def = ITEM[id];
  if (s.unlocked.includes(id)) return fail('Already unlocked.');
  if (s.level < def.unlockLevel) return fail(`Unlocks at level ${def.unlockLevel}.`);
  if (s.cash < def.unlockCost) return fail(`Costs ${money(def.unlockCost)}.`);
  s.cash -= def.unlockCost;
  s.stores[0].today.equipment += def.unlockCost;
  s.unlocked.push(id);
  for (const st of s.stores) st.menu[id].on = true;
  s.stats.recipesUnlocked++;
  return done(s, ok(`${def.name} is on the menu at every store. Stock its ingredients!`));
}

// ------------------------------------------------------------- upgrades

export function upgradeCost(s: GameState, st: Store, id: UpgradeId): number | null {
  const lv = st.upgrades[id];
  const next = UPG[id].levels[lv + 1];
  if (!next) return null;
  let mult = 1;
  for (const e of s.effects) if (e.kind === 'upgradeSale') mult *= e.mult;
  return Math.round(next.cost * mult);
}

export function buyUpgrade(s: GameState, st: Store, id: UpgradeId): Result {
  const def = UPG[id];
  const lv = st.upgrades[id];
  const next = def.levels[lv + 1];
  if (!next) return fail(`${def.name} is maxed out.`);
  if (s.level < next.req) return fail(`${next.name} unlocks at level ${next.req}.`);
  if (def.needs && st.upgrades[def.needs] < 1) return fail(`Requires ${UPG[def.needs].name} first.`);
  const cost = upgradeCost(s, st, id)!;
  if (s.cash < cost) return fail(`${next.name} costs ${money(cost)}.`);
  s.cash -= cost;
  st.today.equipment += cost;
  st.upgrades[id] = lv + 1;
  s.stats.upgradesBought++;
  // drivers start applying as soon as there's something to drive
  if (id === 'delivery' && lv === 0) {
    st.candidates = rollCandidates(s, st, false);
    st.deliverySince = s.day + (s.phase === 'report' ? 1 : 0);
    return done(s, ok(`Installed: ${next.name}. Hire a driver to start taking orders. Delivery starts slow and builds over a few days, and you can pause it any time on this card.`));
  }
  return done(s, ok(`Installed: ${next.name}.`));
}

// ------------------------------------------------------------- marketing

export function runCampaign(s: GameState, st: Store, id: CampaignId): Result {
  const c = CAMPAIGN[id];
  if (s.level < c.req) return fail(`${c.name} unlocks at level ${c.req}.`);
  if (st.campaigns.some((x) => x.id === id)) return fail(`${c.name} is already running here.`);
  if (s.cash < c.cost) return fail(`${c.name} costs ${money(c.cost)}.`);
  s.cash -= c.cost;
  st.today.marketing += c.cost;
  st.campaigns.push({ id, daysLeft: c.days });
  s.stats.campaignsRun++;
  return done(s, ok(`${c.name} is live at ${loc(st).name} for ${c.days} day${c.days > 1 ? 's' : ''}.`));
}

export function buyLoyalty(s: GameState): Result {
  if (s.loyalty) return fail('Already running.');
  if (s.level < LOYALTY.req) return fail(`Unlocks at level ${LOYALTY.req}.`);
  if (s.cash < LOYALTY.cost) return fail(`Costs ${money(LOYALTY.cost)}.`);
  s.cash -= LOYALTY.cost;
  s.stores[0].today.marketing += LOYALTY.cost;
  s.loyalty = true;
  return done(s, ok('Loyalty cards are live at every store.'));
}

// ------------------------------------------------------------- stock

export function orderSupplies(s: GameState, st: Store, lines: Partial<Record<IngId, number>>, express: boolean): Result {
  const r = placeSupplyOrder(s, st, lines, express);
  if (!r.ok) return fail(r.reason ?? 'Order failed.');
  const when = s.phase === 'prep' ? 'delivered now' : express ? 'arriving within the hour' : 'arriving tomorrow morning';
  return done(s, ok(`Ordered ${money(r.cost)} of supplies, ${when}.`));
}

export function setSupplier(st: Store, id: SupplierId): Result {
  st.supplier = id;
  return ok('Supplier changed. New prices apply to future orders.');
}

// ------------------------------------------------------------- finance & expansion

export function takeLoan(s: GameState, amount: number): Result {
  if (s.loan) return fail('Pay off your current loan first.');
  const offer = LOANS.find((l) => l.amount === amount);
  if (!offer || s.level < offer.req) return fail('Loan not available.');
  const total = amount * (1 + DIFFICULTY[s.difficulty].loanInterest);
  s.loan = { principal: amount, remaining: total, daily: Math.ceil((total / LOAN_DAYS) * 100) / 100, daysLeft: LOAN_DAYS };
  s.cash += amount;
  return ok(`Borrowed ${money(amount)}. ${money(s.loan.daily, true)}/day for ${LOAN_DAYS} days.`);
}

export function repayLoan(s: GameState): Result {
  if (!s.loan) return fail('No loan.');
  const pay = s.loan.remaining;
  if (s.cash < pay) return fail(`You need ${money(pay)} to repay.`);
  s.cash -= pay;
  s.stores[0].today.loan += pay;
  s.loan = null;
  return ok('Loan repaid in full.');
}

export function buyLocation(s: GameState, id: LocationId): Result {
  const L = LOC[id];
  if (s.stores.some((x) => x.locationId === id)) return fail('You already own this location.');
  if (s.level < L.reqLevel) return fail(`${L.name} unlocks at level ${L.reqLevel}.`);
  if (s.cash < L.cost) return fail(`${L.name} costs ${money(L.cost)}.`);
  s.cash -= L.cost;
  const st = createStore(s, id, false);
  st.today.equipment += L.cost;
  s.stores.push(st);
  news(s, `Grand opening: ${L.name}! Hire a team and stock the walk-in.`, 'good', false);
  return done(s, ok(`You bought ${L.name}. Hire staff and order stock before opening.`));
}

export function setPar(st: Store, ing: IngId, par: number) {
  st.par[ing] = Math.max(0, Math.round(par));
}

export { storeById };

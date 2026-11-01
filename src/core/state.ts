// Creating a new game / store and read-only helpers used across the sim and UI.
import { INGREDIENTS, ITEM, MENU, type IngId, type ItemId } from '../data/catalog';
import { UPG, UPGRADES, type UpgradeId, type UpgradeLevel } from '../data/upgrades';
import { CLOSE_MIN, LOC, PREP_MIN, SHIFTS, shiftHours, ROLES, OLD_WAGES, type LocationId, type Role } from '../data/world';
import type { DayStats, Difficulty, GameState, Store, Staff, Look } from './types';
import { rand, randInt } from './util';
import { makeStaffFromCandidate, rollCandidates, randomLook, migrateStaff } from './staff';

export const SAVE_VERSION = 4;

export interface DifficultyDef {
  label: string;
  cash: number;
  /** Customer patience in line and at the table. */
  patience: number;
  /** How strongly customers react to prices above fair. */
  priceSens: number;
  /** Rent, wages and ingredient costs. */
  rent: number;
  wage: number;
  ingredients: number;
  /** How much walkouts and refunds drag the rating down. */
  ratingLoss: number;
  /** Weight of bad random events. */
  badEvents: number;
  /** How fast staff morale falls. */
  moraleLoss: number;
  loanInterest: number;
  desc: string;
}
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  relaxed: { label: 'Relaxed', cash: 6000, patience: 1.3, priceSens: 0.85, rent: 0.85, wage: 0.95, ingredients: 0.9, ratingLoss: 0.6, badEvents: 0.6, moraleLoss: 0.7, loanInterest: 0.05, desc: 'Lower costs, patient customers, forgiving reviews.' },
  standard: { label: 'Standard', cash: 3500, patience: 1, priceSens: 1, rent: 1, wage: 1, ingredients: 1, ratingLoss: 1, badEvents: 1, moraleLoss: 1, loanInterest: 0.1, desc: 'The intended experience.' },
  hard: { label: 'Hard', cash: 2400, patience: 0.82, priceSens: 1.2, rent: 1.1, wage: 1.05, ingredients: 1.12, ratingLoss: 1.5, badEvents: 1.5, moraleLoss: 1.3, loanInterest: 0.16, desc: 'Higher costs, impatient and price-sensitive customers, harsh reviews.' },
};

export function emptyDay(day: number, rating: number): DayStats {
  return {
    day, revenue: 0, supplies: 0, wages: 0, rent: 0, marketing: 0, equipment: 0, other: 0, loan: 0, foodCost: 0,
    served: 0, lost: 0, soldOut: 0, refunds: 0, deliveries: 0, satSum: 0, satCount: 0, waste: 0, sold: {}, ratingEnd: rating,
    turnedAway: 0, walkouts: 0, drops: 0, lineWaitSum: 0, lineWaitN: 0, serviceSum: 0, serviceN: 0,
    demandByHour: new Array(13).fill(0), servedByHour: new Array(13).fill(0), used: {}, deliveryFees: 0,
  };
}

export function createStore(s: GameState, locationId: LocationId, starter: boolean): Store {
  const upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>;
  const inventory = Object.fromEntries(INGREDIENTS.map((i) => [i.id, []])) as unknown as Store['inventory'];
  const menu = Object.fromEntries(MENU.map((m) => [m.id, { on: s.unlocked.includes(m.id), price: m.fair }])) as Store['menu'];
  const store: Store = {
    id: ++s.nextId,
    locationId,
    upgrades,
    staff: [],
    candidates: [],
    inventory,
    incoming: [],
    supplier: 'standard',
    autoReorder: false,
    par: {},
    menu,
    customers: [],
    orders: [],
    deliveryQueue: [],
    cleanliness: 85,
    rating: 3,
    campaigns: [],
    today: emptyDay(s.day, 3),
    history: [],
    reviews: [],
    ovenPenalty: 0,
    kiosks: [],
    openedDay: s.day,
    dirty: [],
    specials: [],
    reorderMode: 'forecast',
    orderBuffer: null,
    truckDay: 0,
    fcLog: [],
    expressStreak: 0,
    lastExpressDay: -9,
    mgrOrders: { truck: true, express: false, limit: 150 },
    warned: [],
    jobAd: 0,
    weekly: true,
    autoSchedule: true,
    schedule: {},
  };
  const startStock: Partial<Record<IngId, number>> = starter
    ? { dough: 110, sauce: 110, cheese: 110, pepperoni: 70, basil: 50, soda: 70, box: 120 }
    : { dough: 70, sauce: 70, cheese: 70, pepperoni: 40, basil: 30, soda: 50, box: 80 };
  for (const [k, q] of Object.entries(startStock) as [IngId, number][]) {
    store.inventory[k].push({ qty: q, exp: s.day + shelfDays(store, k) - 1 });
  }
  // a starting cook
  const cook = makeStaffFromCandidate(s, {
    id: ++s.nextId,
    name: starter ? 'Marco R.' : '',
    role: 'cook',
    skill: 1,
    wage: 13,
    traits: starter ? ['reliable'] : [],
    look: randomLook(s),
  });
  if (!cook.name) cook.name = 'New Cook';
  store.staff.push(cook);
  store.schedule[cook.id] = Array(7).fill(cook.shift);
  store.candidates = rollCandidates(s, store);
  return store;
}

export function createGame(company: string, difficulty: Difficulty, seed = Date.now()): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    company: company.trim() || "Tony's Pizza",
    difficulty,
    rng: seed | 0,
    nextId: 0,
    day: 1,
    minute: PREP_MIN,
    phase: 'prep',
    cash: DIFFICULTY[difficulty].cash,
    dayStartCash: DIFFICULTY[difficulty].cash,
    xp: 0,
    level: 1,
    stores: [],
    unlocked: MENU.filter((m) => m.unlockCost === 0).map((m) => m.id),
    loyalty: false,
    loan: null,
    goalIndex: 0,
    goalsDone: [],
    stats: { served: 0, revenue: 0, lost: 0, bestDayRevenue: 0, bestDayProfit: 0, ordersPlaced: 0, upgradesBought: 0, campaignsRun: 0, trained: 0, recipesUnlocked: 0, hires: 0, daysCompleted: 0, deliveries: 0 },
    weather: 'sunny',
    forecast: 'cloudy',
    outlook: ['cloudy', 'sunny', 'sunny', 'cloudy', 'rainy', 'sunny', 'cloudy'],
    effects: [],
    scheduled: [],
    choice: null,
    tomorrowEvent: null,
    tomorrowStore: 0,
    market: Object.fromEntries(INGREDIENTS.map((i) => [i.id, 1])) as Record<IngId, number>,
    report: null,
    news: [],
    negativeDays: 0,
    gameOver: false,
    tutorial: true,
    upcoming: [],
  };
  for (let i = 0; i < 3; i++) rand(s);
  const store = createStore(s, 'maple', true);
  s.stores.push(store);
  return s;
}

// ---------- helpers

export const loc = (st: Store) => LOC[st.locationId];
export function up(st: Store, id: UpgradeId): UpgradeLevel {
  return UPG[id].levels[st.upgrades[id]];
}
export function storeName(s: GameState, st: Store) {
  return `${s.company} · ${LOC[st.locationId].name}`;
}
export function shelfDays(st: Store, ing: IngId) {
  const base = INGREDIENTS.find((i) => i.id === ing)!.shelf;
  if (base >= 999) return 9999;
  return base + (up(st, 'storage').shelfBonus ?? 0);
}
export function stockOf(st: Store, ing: IngId): number {
  let n = 0;
  for (const b of st.inventory[ing]) n += b.qty;
  return n;
}
/** Cold-storage units in use (optionally counting deliveries on the way). */
export function storageUsed(st: Store, includeIncoming = true): number {
  let u = 0;
  for (const i of INGREDIENTS) {
    if (!i.space) continue;
    u += stockOf(st, i.id) * i.space;
    if (includeIncoming) for (const inc of st.incoming) if (inc.ing === i.id) u += inc.qty * i.space;
  }
  return u;
}
/** Space that will be taken tomorrow morning: stock still good tomorrow plus everything ordered. */
export function storageTomorrow(st: Store, day: number): number {
  let u = 0;
  for (const i of INGREDIENTS) {
    if (!i.space) continue;
    for (const b of st.inventory[i.id]) if (b.exp > day) u += b.qty * i.space;
    for (const inc of st.incoming) if (inc.ing === i.id) u += inc.qty * i.space;
  }
  return u;
}
export function storageCap(st: Store) {
  return up(st, 'storage').capacity ?? 440;
}
/** Staff coming in today (not sick, not on a day off). */
export function activeStaff(st: Store, role?: Staff['role']) {
  return st.staff.filter((x) => x.status === 'active' && !x.offToday && (!role || x.role === role));
}
/** Should this person be at work at the current game time? */
export function onShiftNow(s: GameState, x: Staff): boolean {
  if (x.status !== 'active') return false;
  // called in to help: here for that window, day off or not
  const c = x.callIn;
  if (c && c.day === s.day && (s.phase === 'open' || s.phase === 'closing') && s.minute >= c.from && s.minute < c.until) return true;
  if (x.offToday) return false;
  const sh = SHIFTS[x.shift];
  if (s.phase === 'prep') return sh.start <= PREP_MIN + 60;
  if (s.phase === 'report') return false;
  if (s.phase === 'closing') return sh.end >= CLOSE_MIN;
  return s.minute >= sh.start && s.minute < sh.end;
}
/** Staff whose shift covers a given minute of the day. */
export function onShiftAt(st: Store, minute: number, role?: Staff['role']) {
  return st.staff.filter((x) => x.status === 'active' && !x.offToday && (!role || x.role === role) && minute >= SHIFTS[x.shift].start && minute < SHIFTS[x.shift].end);
}
export function hasManager(st: Store) {
  return st.staff.some((x) => x.role === 'manager' && x.status === 'active' && !x.offToday);
}
/** Forecast error band (percent) for this store's Inventory System. */
export function forecastAccuracy(st: Store) {
  return up(st, 'software').accuracy ?? 25;
}
/** Percent of extra stock ordered on top of the forecast. */
export function orderBuffer(st: Store) {
  return st.orderBuffer ?? forecastAccuracy(st);
}
/** A manager trained to skill 2+ can run the supply orders. */
export function orderingManager(st: Store) {
  return st.staff.find((x) => x.role === 'manager' && x.skill >= 2) ?? null;
}
export function canAutoReorder(st: Store) {
  return !!up(st, 'software').autoReorder || st.staff.some((x) => x.role === 'manager');
}
export function tills(st: Store) {
  return up(st, 'register').tills ?? 1;
}
export function seatsTotal(st: Store) {
  return up(st, 'dining').seats ?? 4;
}
export function itemAvailable(st: Store, id: ItemId, needBox: boolean): boolean {
  const def = ITEM[id];
  for (const [k, q] of Object.entries(def.recipe) as [IngId, number][]) if (stockOf(st, k) < q) return false;
  if (needBox && def.type !== 'drink' && stockOf(st, 'box') < 1) return false;
  return true;
}
export function onMenu(s: GameState, st: Store, id: ItemId) {
  return s.unlocked.includes(id) && st.menu[id].on;
}
export function selectedLookFallback(): Look {
  return { skin: 0, hair: 0, shirt: 0, pants: 0, height: 1 };
}
/** Average units used per day over the last few completed days. */
export function avgUsage(st: Store, ing: IngId, days = 3): number {
  const h = st.history.slice(-days);
  if (!h.length) return 0;
  let t = 0;
  for (const d of h) t += d.used?.[ing] ?? 0;
  return t / h.length;
}
export function storeById(s: GameState, id: number) {
  return s.stores.find((x) => x.id === id);
}
/** Today's wage bill: paid hours for everyone scheduled (sick days and days off are unpaid). */
export function dailyWages(st: Store) {
  let w = 0;
  for (const x of st.staff) if (x.status === 'active' && !x.offToday) w += x.wage * shiftHours(x.shift);
  return w;
}
export function staffWage(x: Staff) {
  return x.status === 'active' && !x.offToday ? x.wage * shiftHours(x.shift) : 0;
}

/** Upgrade an older save in place. */
export function migrate(s: GameState) {
  const v = s.version ?? 1;
  s.upcoming ??= [];
  if (!s.outlook || s.outlook.length < 7) s.outlook = [s.forecast, 'sunny', 'cloudy', 'sunny', 'cloudy', 'rainy', 'sunny'];
  else s.outlook[0] = s.forecast;
  for (const st of s.stores) {
    st.dirty ??= [];
    st.specials ??= st.special ? [{ id: st.special, window: 'all', pct: 15 }] : [];
    delete st.special;
    st.reorderMode ??= 'forecast';
    st.orderBuffer ??= null;
    st.truckDay ??= 0;
    st.fcLog ??= [];
    st.expressStreak ??= 0;
    st.lastExpressDay ??= -9;
    st.mgrOrders ??= { truck: true, express: false, limit: 150 };
    st.warned ??= [];
    st.jobAd ??= 0;
    st.schedule ??= {};
    // 0.3.20: the weekly schedule is how staffing works now; day-by-day saves move onto it
    if (!st.weekly) {
      st.weekly = true;
      for (const x of st.staff) st.schedule[x.id] ??= Array(7).fill(x.shift);
    }
    // v3 added two storage tiers: map old levels onto the new ladder
    if (v < 3) st.upgrades.storage = [0, 2, 3, 4][st.upgrades.storage] ?? 4;
    st.customers = [];
    st.orders = st.orders.filter((o) => o.kind === 'delivery' && o.state !== 'out');
    st.deliveryQueue = st.orders.map((o) => o.id);
    st.kiosks = [];
    delete st.kiosk;
    const fresh = emptyDay(st.today.day, st.today.ratingEnd);
    st.today = { ...fresh, ...st.today, demandByHour: st.today.demandByHour ?? fresh.demandByHour, servedByHour: st.today.servedByHour ?? fresh.servedByHour, used: st.today.used ?? {} };
    for (const h of st.history) {
      h.used ??= {};
      h.turnedAway ??= 0;
      h.walkouts ??= 0;
    }
    // old saves tracked usage separately; fold the most recent into history
    if (st.usage && st.usage.length > 1) {
      const past = st.usage.slice(0, -1);
      past.forEach((u, i) => {
        const h = st.history[st.history.length - past.length + i];
        if (h && !Object.keys(h.used).length) h.used = { ...u };
      });
    }
    delete st.usage;
    for (const x of st.staff) migrateStaff(x);
    // v4 (0.3.29): new pay scale. Keep everyone's pay in the same place relative to the market
    // (a well-paid cook stays well-paid), just on the new, lower scale.
    if (v < 4) {
      const rescale = (role: Role, skill: number, wage: number) => {
        const [b, k] = OLD_WAGES[role];
        const was = (b + k * (skill - 1)) * DIFFICULTY[s.difficulty].wage;
        const now = (ROLES[role].baseWage + ROLES[role].perSkill * (skill - 1)) * DIFFICULTY[s.difficulty].wage;
        return Math.max(7.25, Math.round(((wage / was) * now) * 4) / 4);
      };
      for (const x of st.staff) x.wage = rescale(x.role, x.skill, x.wage);
      for (const c of st.candidates ?? []) c.wage = rescale(c.role, c.skill, c.wage);
      // managers on doubles every day get a normal week: five closing shifts, two days off
      for (const x of st.staff) {
        const row = st.schedule[x.id];
        if (x.role === 'manager' && row && row.filter((v) => v === 'full').length > 5) st.schedule[x.id] = ['close8', 'close8', 'off', 'close8', 'close8', 'close8', 'off'];
      }
    }
  }
  if (v < 2 && (s.phase === 'open' || s.phase === 'closing')) {
    // mid-day v1 saves restart the day cleanly
    s.minute = Math.min(s.minute, CLOSE_MIN - 1);
  }
  s.version = SAVE_VERSION;
}
export { randInt };

/**
 * Spare equipment helps a little: an unstaffed till or make-line station means more counter
 * space and prepped stock within reach. First spare 6%, second 4% more, capped at 10%, and
 * always worth far less than a person working it.
 */
export function spareBonus(spare: number): number {
  return spare <= 0 ? 0 : spare === 1 ? 0.06 : 0.1;
}

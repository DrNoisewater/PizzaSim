// Stock: consumption (first-expiring first), deliveries, spoilage, auto-reorder.
import { ING, INGREDIENTS, ITEM, type IngId, type ItemId } from '../data/catalog';
import type { GameState, Store } from './types';
import { canAutoReorder, hasManager, orderBuffer, orderingManager, loc, shelfDays, stockOf, storageCap, storageTomorrow, storageUsed } from './state';
import { ingredientPrice } from './economy';
import { dayNeed, orderTarget, runsOutAt } from './forecast';
import { CLOSE_MIN } from '../data/world';
import { clock, emit, money, news, now } from './util';

/** Did the last consumeItem() use any fresh ingredient on its final day? (Critics notice.) */
let staleFlag = false;
let staleDay = 0;
export const lastWasStale = () => staleFlag;

export function consume(st: Store, ing: IngId, qty: number): boolean {
  if (stockOf(st, ing) < qty) return false;
  const batches = st.inventory[ing].sort((a, b) => a.exp - b.exp);
  let need = qty;
  for (const b of batches) {
    const take = Math.min(b.qty, need);
    if (take > 0 && b.exp <= staleDay && ING[ing].shelf < 30) staleFlag = true;
    b.qty -= take;
    need -= take;
    if (need <= 0) break;
  }
  st.inventory[ing] = batches.filter((b) => b.qty > 0);
  st.today.used[ing] = (st.today.used[ing] ?? 0) + qty;
  return true;
}

/** Consume everything an item needs. Caller must check availability first. */
export function consumeItem(s: GameState, st: Store, id: ItemId, boxed: boolean): number {
  let cost = 0;
  staleFlag = false;
  staleDay = s.day;
  for (const [k, q] of Object.entries(ITEM[id].recipe) as [IngId, number][]) {
    consume(st, k, q);
    cost += ingredientPrice(s, st, k) * q;
  }
  if (boxed && ITEM[id].type !== 'drink') {
    consume(st, 'box', 1);
    cost += ingredientPrice(s, st, 'box');
  }
  return cost;
}

export function addStock(s: GameState, st: Store, ing: IngId, qty: number) {
  if (qty <= 0) return;
  const exp = s.day + shelfDays(st, ing) - 1;
  const same = st.inventory[ing].find((b) => b.exp === exp);
  if (same) same.qty += qty;
  else st.inventory[ing].push({ qty, exp });
}

export interface OrderResult {
  ok: boolean;
  cost: number;
  reason?: string;
}

/** Express deliveries: how long they take and what the supplier charges on top. */
export const EXPRESS_MIN = 90;
export const EXPRESS_FEE = 15;
/** Price multiplier and flat fee for an express order right now (the rush surcharge grows on back-to-back days). */
export function expressTerms(s: GameState, st: Store) {
  const streak = st.lastExpressDay === s.day ? st.expressStreak : st.lastExpressDay === s.day - 1 ? st.expressStreak + 1 : 1;
  const mult = 1.5 + 0.1 * Math.min(5, Math.max(0, streak - 1));
  return { mult, fee: EXPRESS_FEE, streak };
}
export function expressCost(s: GameState, st: Store, goods: number) {
  const e = expressTerms(s, st);
  return goods * e.mult + e.fee;
}

/** Place a supply order. During prep it arrives immediately; while open it arrives next morning, or in 90 min if express. */
export function placeSupplyOrder(s: GameState, st: Store, lines: Partial<Record<IngId, number>>, express: boolean): OrderResult {
  let goods = 0, space = 0;
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    if (!q || q <= 0) continue;
    goods += ingredientPrice(s, st, k) * q;
    space += ING[k].space * q;
  }
  if (goods <= 0) return { ok: false, cost: 0, reason: 'Nothing in the cart.' };
  const terms = express ? expressTerms(s, st) : null;
  const cost = terms ? goods * terms.mult + terms.fee : goods;
  // deliveries arriving tomorrow only compete with stock that survives tonight
  const used = s.phase === 'prep' || express ? storageUsed(st) : storageTomorrow(st, s.day);
  if (used + space > storageCap(st) + 1e-6) return { ok: false, cost, reason: `Not enough cold storage: ${Math.ceil(used + space - storageCap(st))} units over. Upgrade storage or order less.` };
  if (s.cash < cost) return { ok: false, cost, reason: 'Not enough cash.' };
  s.cash -= cost;
  st.today.supplies += cost;
  if (terms) {
    st.today.expressOrders = (st.today.expressOrders ?? 0) + 1;
    st.today.expressFees = (st.today.expressFees ?? 0) + (cost - goods);
    if (st.lastExpressDay !== s.day) {
      st.expressStreak = terms.streak;
      st.lastExpressDay = s.day;
    }
  }
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    if (!q || q <= 0) continue;
    if (s.phase === 'prep') addStock(s, st, k, q);
    else st.incoming.push({ ing: k, qty: q, at: express ? now(s) + EXPRESS_MIN : -1 });
  }
  if (s.phase === 'prep') st.truckDay = s.day;
  s.stats.ordersPlaced++;
  return { ok: true, cost };
}

/** Deliver anything due. morning=true delivers next-morning orders too. */
export function receiveDeliveries(s: GameState, st: Store, morning: boolean) {
  const t = now(s);
  const keep = [];
  let got = false;
  for (const inc of st.incoming) {
    if ((morning && inc.at < 0) || (inc.at >= 0 && inc.at <= t)) {
      addStock(s, st, inc.ing, inc.qty);
      got = true;
    } else keep.push(inc);
  }
  st.incoming = keep;
  return got;
}

/** Remove expired batches at the end of a day. Returns wasted value. */
export function spoil(s: GameState, st: Store): number {
  let waste = 0;
  const mgr = hasManager(st);
  for (const i of INGREDIENTS) {
    const keep = [];
    for (const b of st.inventory[i.id]) {
      if (b.exp <= s.day) {
        // a manager rescues some product (staff meals, specials)
        const lost = mgr ? Math.ceil(b.qty * 0.7) : b.qty;
        waste += lost * i.cost;
      } else keep.push(b);
    }
    st.inventory[i.id] = keep;
  }
  return waste;
}

/** Nightly auto-reorder for the next morning: tomorrow's forecast, or par levels. */
export function autoReorder(s: GameState, st: Store): number {
  if (!st.autoReorder || !canAutoReorder(st)) return 0;
  const lines: Partial<Record<IngId, number>> = st.reorderMode === 'forecast' ? suggestOrder(s, st, 'tomorrow') : {};
  if (st.reorderMode === 'par') {
    for (const i of INGREDIENTS) {
      const par = st.par[i.id] ?? 0;
      if (par <= 0) continue;
      let usable = 0;
      for (const b of st.inventory[i.id]) if (b.exp > s.day) usable += b.qty;
      for (const inc of st.incoming) if (inc.ing === i.id) usable += inc.qty;
      const need = par - usable;
      if (need > 0) lines[i.id] = Math.ceil(need);
    }
  }
  if (!Object.keys(lines).length) return 0;
  // fit to storage and cash
  let free = storageCap(st) - storageTomorrow(st, s.day);
  const fitted: Partial<Record<IngId, number>> = {};
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    const fit = ING[k].space ? Math.min(q, Math.floor(free / ING[k].space)) : q;
    if (fit > 0) {
      fitted[k] = fit;
      free -= fit * ING[k].space;
    }
  }
  let cost = 0;
  for (const [k, q] of Object.entries(fitted) as [IngId, number][]) cost += ingredientPrice(s, st, k) * q;
  if (cost <= 0 || s.cash < cost) return 0;
  s.cash -= cost;
  st.today.supplies += cost;
  for (const [k, q] of Object.entries(fitted) as [IngId, number][]) st.incoming.push({ ing: k, qty: q, at: -1 });
  return cost;
}

export function expiringSoon(s: GameState, st: Store, ing: IngId) {
  let n = 0;
  for (const b of st.inventory[ing]) if (b.exp <= s.day + 1) n += b.qty;
  return n;
}
/** Units that will spoil at the end of today. */
export function expiringTonight(s: GameState, st: Store, ing: IngId) {
  let n = 0;
  for (const b of st.inventory[ing]) if (b.exp <= s.day) n += b.qty;
  return n;
}

/** Ingredients used by anything currently on the menu (plus boxes). */
export function neededIngredients(s: GameState, st: Store): IngId[] {
  const need = new Set<IngId>();
  for (const m of Object.values(ITEM)) {
    if (!s.unlocked.includes(m.id) || !st.menu[m.id].on) continue;
    for (const k of Object.keys(m.recipe)) need.add(k as IngId);
  }
  if (need.size) need.add('box');
  return INGREDIENTS.map((i) => i.id).filter((id) => need.has(id));
}

/** Multiplier for the order buffer on top of the forecast. */
export const bufferMult = (st: Store) => 1 + orderBuffer(st) / 100;

/** Forecast units of an ingredient for the day being planned (today in the morning, tomorrow otherwise). No buffer. */
export function estimateDailyNeed(s: GameState, st: Store, ing: IngId, which: 'today' | 'tomorrow' = orderTarget(s)): number {
  return Math.ceil(dayNeed(s, st, which)[ing] ?? 0);
}

/** Roughly how many days current stock lasts at the planned day's pace. */
export function daysOfCover(s: GameState, st: Store, ing: IngId): number | null {
  const daily = dayNeed(s, st, orderTarget(s))[ing] ?? 0;
  if (daily <= 0.5) return null;
  let n = stockOf(st, ing);
  for (const inc of st.incoming) if (inc.ing === ing) n += inc.qty;
  return n / daily;
}

/** Stock still on hand for the planned day: what's usable tomorrow, minus what today will still eat. */
export function onHandFor(s: GameState, st: Store, ing: IngId, which: 'today' | 'tomorrow'): number {
  if (which === 'today') {
    let n = stockOf(st, ing);
    for (const inc of st.incoming) if (inc.ing === ing && inc.at >= 0) n += inc.qty;
    return n;
  }
  let usable = 0;
  for (const b of st.inventory[ing]) if (b.exp > s.day) usable += b.qty;
  // the rest of today will still use some of it
  if (s.phase === 'open') usable = Math.max(0, usable - (dayNeed(s, st, 'today', s.minute)[ing] ?? 0));
  for (const inc of st.incoming) if (inc.ing === ing) usable += inc.qty;
  return Math.floor(usable);
}

/** Cart that tops stock up to the planned day's forecast plus the order buffer, trimmed to fit cold storage. */
export function suggestOrder(s: GameState, st: Store, which: 'today' | 'tomorrow' = orderTarget(s)): Partial<Record<IngId, number>> {
  const lines: Partial<Record<IngId, number>> = {};
  const need = dayNeed(s, st, which);
  let space = 0;
  for (const k of neededIngredients(s, st)) {
    // boxes and cans don't spoil or use cold storage: keep about two days on hand
    const buffer = ING[k].space === 0 && ING[k].shelf > 30 ? Math.max(2, bufferMult(st)) : bufferMult(st);
    const want = Math.ceil((need[k] ?? 0) * buffer) - onHandFor(s, st, k, which);
    if (want > 0) {
      lines[k] = Math.ceil(want / 5) * 5;
      space += lines[k]! * ING[k].space;
    }
  }
  const free = storageCap(st) - (which === 'today' ? storageUsed(st) : storageTomorrow(st, s.day));
  if (space > free && space > 0) {
    const f = Math.max(0, free / space);
    for (const k of Object.keys(lines) as IngId[]) if (ING[k].space) lines[k] = Math.floor(lines[k]! * f);
  }
  for (const k of Object.keys(lines) as IngId[]) if (!lines[k]) delete lines[k];
  return lines;
}

/** How early (minutes) a low-stock warning comes, by Inventory System level. */
export const warnLead = (st: Store) => [150, 180, 240][st.upgrades.software] ?? 240;

/**
 * Checked every 15 minutes while open: warn about ingredients that will run out before close
 * (once each per day), and let an authorized manager place an express order in time.
 */
export function stockWatch(s: GameState, st: Store) {
  if (s.phase !== 'open') return;
  const mgr = orderingManager(st);
  for (const k of neededIngredients(s, st)) {
    const out = runsOutAt(s, st, k);
    if (out === null || out >= CLOSE_MIN) continue;
    const lead = out - s.minute;
    const rushing = st.incoming.some((i) => i.ing === k && i.at >= 0);
    if (mgr && st.mgrOrders.express && !rushing && lead < EXPRESS_MIN + 75) {
      let have = stockOf(st, k);
      for (const i of st.incoming) if (i.ing === k && i.at >= 0) have += i.qty;
      const rest = (dayNeed(s, st, 'today', s.minute)[k] ?? 0) * bufferMult(st);
      const qty = Math.ceil(Math.max(0, rest - have) / 5) * 5;
      if (qty > 0) {
        const cost = expressCost(s, st, ingredientPrice(s, st, k) * qty);
        if (cost <= st.mgrOrders.limit) {
          const r = placeSupplyOrder(s, st, { [k]: qty }, true);
          if (r.ok) {
            st.warned.push(k);
            emit({ type: 'toast', storeId: st.id, tone: 'info', text: `${mgr.name} rushed ${qty} ${ING[k].name.toLowerCase()} (express, ${money(r.cost)}). Arrives ~${clock(s.minute + EXPRESS_MIN)}.` });
            news(s, `${mgr.name} placed an express order for ${ING[k].name.toLowerCase()} at ${loc(st).name} (${money(r.cost)}).`, 'info');
            continue;
          }
        }
      }
    }
    if (st.warned.includes(k) || lead > warnLead(st)) continue;
    st.warned.push(k);
    const fix = rushing ? 'An express order is already on the way.' : lead > EXPRESS_MIN ? `Express delivery takes ${EXPRESS_MIN} min, so there's still time.` : 'Too late for express to beat it. Consider pulling items that use it.';
    emit({ type: 'toast', storeId: st.id, tone: 'bad', text: `Running low at ${loc(st).name}: ${ING[k].name} runs out ~${clock(out)}. ${fix}` });
  }
}

/** Trim an order so it costs at most budget, scaling every line down evenly. */
export function fitToBudget(s: GameState, st: Store, lines: Partial<Record<IngId, number>>, budget: number): Partial<Record<IngId, number>> {
  let cost = 0;
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) cost += ingredientPrice(s, st, k) * q;
  if (cost <= budget) return lines;
  const f = Math.max(0, budget / Math.max(1, cost));
  const out: Partial<Record<IngId, number>> = {};
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    const v = Math.floor(q * f);
    if (v > 0) out[k] = v;
  }
  return out;
}

/**
 * What the morning truck still needs to bring: everything the first time, then only a meaningful
 * top-up (after an upgrade or new hires raise capacity, for example).
 */
export function truckLines(s: GameState, st: Store): Partial<Record<IngId, number>> {
  const lines = suggestOrder(s, st, 'today');
  if (st.truckDay !== s.day) return lines;
  const need = dayNeed(s, st, 'today');
  let want = 0, total = 0;
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) if (ING[k].space) want += q;
  for (const [k, q] of Object.entries(need) as [IngId, number][]) if (ING[k].space) total += q;
  return want >= Math.max(15, total * 0.12) ? lines : {};
}

export { now };

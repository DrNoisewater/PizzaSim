// The minute-by-minute store simulation. Pure state in, pure state out (plus outbox events).
// Walking takes game time: customers and staff only act once they have actually reached
// the till, the table or the shelf, so the 3D view can always show what is happening.
import { ITEM, MENU, type ItemId } from '../data/catalog';
import { CLOSE_MIN, DELIVERY_FEE, HARD_CLOSE_MIN, MILEAGE_PER_TRIP, OPEN_MIN, ROLES, SHIFTS, WEATHER } from '../data/world';
import { REVIEW_LINES, REVIEW_OPEN, REVIEW_CLOSE, type ReviewTopic, type ReviewDetail } from '../data/text';
import type { Customer, GameState, LeaveReason, Order, OrderItem, RemakeReason, Sensitivity, Staff, Store, Task } from './types';
import { DIFFICULTY, hasManager, itemAvailable, loc, onMenu, onShiftNow, seatsTotal, spareBonus, tills, up } from './state';
import { choosePizza, customerPatience, deliveryRate, pizzaQuality, salePrice, satisfaction, walkInRate } from './economy';
import { consumeItem, receiveDeliveries, stockWatch, lastWasStale } from './inventory';
import { setPriceClock } from './economy';
import { dropChance, gainXp, mistakeMult, randomLook, randomName, staffSpeed, wrongToppingChance } from './staff';
import { addXp, checkGoals } from './progression';
import { clamp, emit, money, news, newId, now, pickOne, poisson, rand, weighted } from './util';
import { endDay, runScheduled } from './day';
import { watchInspection } from './inspector';
import { criticVerdict } from './critic';
import { stepHelpReplies } from './manager';
import {
  BACK_OUT, CLEAN_POINTS, COOK_IDLE, DOOR_OUT, DRIVER_IDLE, FRONT_IDLE, KIOSK_SPOTS, kioskCount, MANAGER_POS, PASS, PICKUP_CUST, PICKUP_STAFF,
  QUEUE, SIDEWALK_Z, WAIT, floorConfig, seatPos, snap, stationSpot, tableSide, tillCust, tillStaff, walkMinutes, type FloorConfig, type P2,
} from './layout';

export const STEP = 0.25;
const MAX_LINE = 10;
const KIOSK_MIN = 1.4;

/** Advance the world by `minutes` of game time. */
export function advance(s: GameState, minutes: number) {
  if ((s.phase !== 'open' && s.phase !== 'closing') || s.choice || s.notice || s.gameOver) return;
  let left = minutes;
  let guard = 0;
  while (left > 1e-9 && guard++ < 4000) {
    const dt = Math.min(STEP, left);
    step(s, dt);
    left -= dt;
    if (s.phase !== 'open' && s.phase !== 'closing') break;
    if (s.choice || s.notice) break;
  }
}

function step(s: GameState, dt: number) {
  s.minute += dt;
  setPriceClock(s.minute);
  if (s.phase === 'open' && s.minute >= CLOSE_MIN) {
    s.phase = 'closing';
    news(s, 'Doors closed for the night. Finishing the last orders.', 'info', false);
  }
  for (const st of s.stores) stepStore(s, st, dt);
  runScheduled(s);
  if (Math.floor(s.minute) % 15 === 0 && Math.floor(s.minute - dt) % 15 !== 0) {
    checkGoals(s);
    for (const st of s.stores) stockWatch(s, st);
  }
  if (s.phase === 'closing') {
    const busy = s.stores.some((st) => st.customers.some((c) => c.state !== 'leave') || st.orders.length > 0);
    if (!busy || s.minute >= HARD_CLOSE_MIN) endDay(s);
  }
}

// ------------------------------------------------------------------ helpers

/** Floor plan of a store (furniture depends on upgrades). */
export function storeFloor(s: GameState, st: Store): FloorConfig {
  return floorConfig(st, st.staff.some((x) => x.role === 'manager') || s.level >= 4);
}
const hourIdx = (s: GameState) => clamp(Math.floor((s.minute - OPEN_MIN) / 60), 0, 12);
const walkC = (fc: FloorConfig, a: P2, b: P2) => walkMinutes(fc, a, b, true);
const walkS = (fc: FloorConfig, a: P2, b: P2) => walkMinutes(fc, a, b, false);
const isFront = (x: Staff) => x.role === 'front';

export function homeSpot(st: Store, x: Staff, fc: FloorConfig): P2 {
  const peers = st.staff.filter((y) => y.role === x.role);
  const i = Math.max(0, peers.indexOf(x));
  let p: P2;
  switch (x.role) {
    case 'cook': p = i < fc.stations ? stationSpot(i) : COOK_IDLE[(i - fc.stations) % COOK_IDLE.length]; break;
    case 'front': p = FRONT_IDLE[i % FRONT_IDLE.length]; break;
    case 'driver': p = DRIVER_IDLE[i % DRIVER_IDLE.length]; break;
    default: p = MANAGER_POS;
  }
  return snap(fc, p, false);
}

/** Put someone on a walking or working job. travel = minutes of walking first. */
function give(x: Staff, kind: Task['kind'], to: P2, travel: number, work: number, extra: Partial<Task> = {}) {
  const total = Math.max(0.05, travel + work);
  x.task = { kind, remaining: total, total, travel, to, ...extra };
  x.pos = [to[0], to[1]];
}

// ------------------------------------------------------------------ store step

function stepStore(s: GameState, st: Store, dt: number) {
  const fc = storeFloor(s, st);
  receiveDeliveries(s, st, false);
  clockInOut(s, st, fc);
  if (s.phase === 'open') {
    const nWalk = poisson(s, (walkInRate(s, st) * dt) / 60);
    for (let i = 0; i < nWalk; i++) spawnCustomer(s, st, false, fc);
    const hasDriver = st.staff.some((x) => x.role === 'driver' && onShiftNow(s, x));
    const nDel = poisson(s, (deliveryRate(s, st, hasDriver) * dt) / 60);
    for (let i = 0; i < nDel; i++) spawnDelivery(s, st);
  }
  updateCustomers(s, st, dt, fc);
  stepHelpReplies(s, st);
  if (s.phase === 'open') {
    st.today.cleanSum = (st.today.cleanSum ?? 0) + st.cleanliness * dt;
    st.today.cleanN = (st.today.cleanN ?? 0) + dt;
  }
  if (st.inspector) watchInspection(s, st, dt);
  progressTasks(s, st, dt, fc);
  assignTasks(s, st, fc);
  updateOvens(s, st, dt);
  checkOrders(s, st, fc);
  // cleanliness & energy
  const decay = up(st, 'cleaning').decay ?? 1;
  let inside = 0;
  for (const c of st.customers) if (c.state !== 'enter' && c.state !== 'leave') inside++;
  st.cleanliness -= 0.007 * dt * decay * (1 + inside * 0.18);
  const brk = up(st, 'breakroom').energy ?? 0;
  for (const x of st.staff) {
    if (!x.onFloor) continue;
    x.shiftMin += dt;
    const busy = x.task !== null && x.task.kind !== 'walk';
    if (busy) x.busyMin += dt;
    x.energy = clamp(x.energy - (busy ? 0.065 : 0.02) * dt + (brk / 60) * dt * (busy ? 0.3 : 1), 0, 100);
    // idle kitchen crew wipe down their station, but only once things look grubby
    if (!x.task && x.role === 'cook' && st.cleanliness < 84) st.cleanliness += 0.02 * dt;
  }
  st.cleanliness = clamp(st.cleanliness, 0, 100);
}

/** Opening-shift staff are already in place when the doors open. */
export function placeOpeningStaff(s: GameState, st: Store) {
  const fc = storeFloor(s, st);
  for (const x of st.staff) {
    x.task = null;
    if (onShiftNow(s, x)) {
      x.onFloor = true;
      x.pos = homeSpot(st, x, fc);
    } else {
      x.onFloor = false;
      x.pos = [...BACK_OUT];
    }
  }
}

/** Staff arrive for their shift through the back door and leave when it ends. */
function clockInOut(s: GameState, st: Store, fc: FloorConfig) {
  for (const x of st.staff) {
    const should = onShiftNow(s, x);
    if (should && !x.onFloor) {
      x.onFloor = true;
      x.pos = [...BACK_OUT];
      const home = homeSpot(st, x, fc);
      give(x, 'walk', home, walkS(fc, BACK_OUT, home), 0);
    } else if (!should && x.onFloor && !x.task) {
      if (x.pos[0] === BACK_OUT[0] && x.pos[1] === BACK_OUT[1]) {
        x.onFloor = false;
        continue;
      }
      give(x, 'walk', BACK_OUT, walkS(fc, x.pos, BACK_OUT), 0);
    }
  }
}

function lineLength(st: Store) {
  let n = 0;
  for (const c of st.customers) if (c.state === 'enter' || c.state === 'queue' || c.state === 'ordering') n++;
  return n;
}

/** Personalities: most people are average, some fuss about one thing, a few about everything. */
const PERSONAS: { w: number; label?: string; clean: number; wait: number; price: number }[] = [
  { w: 50, clean: 1, wait: 1, price: 1 },
  { w: 10, label: 'Neat freak', clean: 1.7, wait: 1, price: 1 },
  { w: 16, label: 'Easygoing', clean: 0.5, wait: 0.6, price: 0.8 },
  { w: 9, label: 'In a hurry', clean: 1, wait: 1.6, price: 1 },
  { w: 9, label: 'Bargain hunter', clean: 1, wait: 1, price: 1.6 },
  { w: 6, label: 'Hard to please', clean: 1.4, wait: 1.3, price: 1.3 },
];
export function rollSensitivity(s: GameState): Sensitivity {
  const p = weighted(s, PERSONAS.map((v) => ({ v, w: v.w }))) ?? PERSONAS[0];
  const j = () => 0.88 + rand(s) * 0.24;
  return { clean: p.clean * j(), wait: p.wait * j(), price: p.price * j(), label: p.label };
}

/** Most people never write a review. Delighted and furious ones do, and so do the fussy. */
function reviewChance(stars: number, sens?: Sensitivity) {
  let p = 0.05 + 0.06 * Math.abs(stars - 3);
  if (sens?.label === 'Hard to please') p += 0.05;
  if (sens?.label === 'Easygoing') p *= 0.6;
  return p;
}

export function spawnCustomer(s: GameState, st: Store, critic: boolean, fc = storeFloor(s, st)) {
  st.today.demandByHour[hourIdx(s)]++;
  const line = lineLength(st);
  if (!critic && line >= MAX_LINE) {
    st.today.turnedAway++;
    emit({ type: 'turnaway', storeId: st.id });
    return;
  }
  const side = rand(s) < 0.5 ? -1 : 1;
  const spawn: P2 = [DOOR_OUT[0] + side * (2.5 + rand(s) * 4), SIDEWALK_Z + (rand(s) - 0.5) * 0.5];
  let slot = 0;
  for (const c of st.customers) if (c.state === 'enter' || c.state === 'queue') slot++;
  const target = QUEUE[Math.min(slot, QUEUE.length - 1)];
  const sens = rollSensitivity(s);
  const c: Customer = {
    id: newId(s),
    kind: critic || rand(s) < 0.55 ? 'dine' : 'takeout',
    state: 'enter',
    t: 0,
    dur: walkC(fc, spawn, target),
    patience: (customerPatience(s, st) * (critic ? 1.5 : 1)) / Math.pow(sens.wait, 0.6),
    arrived: now(s),
    pos: spawn,
    from: spawn,
    slot,
    mood: 'none',
    look: randomLook(s),
    critic,
    sens,
  };
  c.pos = target;
  st.customers.push(c);
}

function rateLost(s: GameState, st: Store, w: number) {
  w *= DIFFICULTY[s.difficulty].ratingLoss;
  st.rating = clamp(st.rating + (1 - st.rating) * w, 1, 5);
}

function spawnDelivery(s: GameState, st: Store) {
  st.today.demandByHour[hourIdx(s)]++;
  // the ordering app shows the wait; a long one puts people off
  const quote = quotedWait(s, st) + 18 * loc(st).deliveryDist;
  if (quote > 50 * DIFFICULTY[s.difficulty].patience * (0.8 + rand(s) * 0.5)) {
    st.today.turnedAway++;
    return;
  }
  const items = buildItems(s, st, true, 0, true);
  if (!items) {
    st.today.lost++;
    st.today.soldOut++;
    s.stats.lost++;
    return;
  }
  const o = createOrder(s, st, 'delivery', items, undefined, 0);
  o.expected = 38 * loc(st).deliveryDist;
}

/** Choose and reserve items for a new order. Returns null if no pizza can be made. */
function buildItems(s: GameState, st: Store, boxed: boolean, upsell: number, delivery: boolean): OrderItem[] | null {
  const r = rand(s);
  const nP = delivery ? (r < 0.55 ? 1 : r < 0.9 ? 2 : 3) : r < 0.78 ? 1 : r < 0.96 ? 2 : 3;
  const items: OrderItem[] = [];
  let cost = 0;
  for (let i = 0; i < nP; i++) {
    let id = choosePizza(s, st);
    if (!id) break;
    if (!itemAvailable(st, id, boxed)) {
      // the till shows it as sold out; most people pick something else
      if (rand(s) < (i === 0 ? 0.8 : 0.6)) {
        const alts = MENU.filter((m) => m.type === 'pizza' && onMenu(s, st, m.id) && itemAvailable(st, m.id, boxed));
        id = alts.length ? pickOne(s, alts).id : null;
      } else id = null;
    }
    if (!id) continue;
    cost += consumeItem(s, st, id, boxed);
    items.push({ item: id, stage: 'queued', progress: 0, quality: 60, stale: lastWasStale() || undefined });
  }
  if (!items.length) return null;
  if (onMenu(s, st, 'knots') && rand(s) < 0.28 + upsell && itemAvailable(st, 'knots', boxed)) {
    cost += consumeItem(s, st, 'knots', boxed);
    items.push({ item: 'knots', stage: 'queued', progress: 0, quality: 60, stale: lastWasStale() || undefined });
  }
  const drinkChance = (0.4 + upsell) * WEATHER[s.weather].drinks * (loc(st).prefs.soda ?? 1);
  if (onMenu(s, st, 'soda') && rand(s) < drinkChance && itemAvailable(st, 'soda', false)) {
    cost += consumeItem(s, st, 'soda', false);
    items.push({ item: 'soda', stage: 'done', progress: 1, quality: 70 });
    if (rand(s) < drinkChance * 0.3 && itemAvailable(st, 'soda', false)) {
      cost += consumeItem(s, st, 'soda', false);
      items.push({ item: 'soda', stage: 'done', progress: 1, quality: 70 });
    }
  }
  st.today.foodCost += cost;
  return items;
}

function createOrder(s: GameState, st: Store, kind: Order['kind'], items: OrderItem[], c: Customer | undefined, charm: number): Order {
  let total = 0;
  for (const it of items) {
    total += salePrice(st, it.item);
    st.today.sold[it.item] = (st.today.sold[it.item] ?? 0) + 1;
  }
  if (kind === 'delivery') {
    total += DELIVERY_FEE;
    st.today.deliveryFees += DELIVERY_FEE;
  }
  total = Math.round(total * 100) / 100;
  const o: Order = {
    id: newId(s),
    kind,
    customerId: c?.id,
    name: randomName(s),
    items,
    total,
    placed: now(s),
    expected: kind === 'dine' ? 22 : 18,
    state: 'kitchen',
    charm,
    critic: c?.critic,
    sens: c ? c.sens : rollSensitivity(s),
  };
  st.orders.push(o);
  s.cash += total;
  st.today.revenue += total;
  s.stats.revenue += total;
  const todayAll = s.stores.reduce((a, x) => a + x.today.revenue, 0);
  if (todayAll > s.stats.bestDayRevenue) s.stats.bestDayRevenue = todayAll;
  emit({ type: 'sale', storeId: st.id, amount: total, customerId: c?.id });
  return o;
}

// ------------------------------------------------------------------ customers

function freeSeat(s: GameState, st: Store): number {
  const n = seatsTotal(st);
  const used = new Set<number>(st.dirty);
  for (const c of st.customers) if (c.seat !== undefined && c.state !== 'leave') used.add(c.seat);
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!used.has(i)) free.push(i);
  if (!free.length) return -1;
  return free[Math.floor(rand(s) * free.length)];
}
function freeWaitSpot(st: Store): number {
  const used = new Set<number>();
  for (const c of st.customers) if (c.waitSpot !== undefined && c.state !== 'leave') used.add(c.waitSpot);
  for (let i = 0; i < WAIT.length; i++) if (!used.has(i)) return i;
  return WAIT.length - 1;
}

/** Send a customer out through the front door. */
function leave(st: Store, c: Customer, why: LeaveReason, fc: FloorConfig) {
  if (c.kind === 'dine' && c.seat !== undefined && c.state === 'eating' && !st.dirty.includes(c.seat)) st.dirty.push(c.seat);
  c.state = 'leave';
  c.t = 0;
  c.why = why;
  const from = c.pos;
  c.from = from;
  c.dur = walkC(fc, from, DOOR_OUT);
  c.pos = [...DOOR_OUT];
}

function updateCustomers(s: GameState, st: Store, dt: number, fc: FloorConfig) {
  const t = now(s);
  for (const c of st.customers) {
    c.t += dt;
    switch (c.state) {
      case 'enter':
        if (c.t >= c.dur) {
          c.state = 'queue';
          c.t = 0;
          c.arrived = t;
        }
        break;
      case 'queue': {
        const f = c.t / c.patience;
        c.mood = f < 0.45 ? 'happy' : f < 0.8 ? 'ok' : 'angry';
        if (c.t > c.patience) {
          c.mood = 'angry';
          st.today.lost++;
          st.today.walkouts++;
          s.stats.lost++;
          rateLost(s, st, 0.006);
          emit({ type: 'walkout', storeId: st.id, customerId: c.id, text: 'Too slow!' });
          if (c.critic) criticVerdict(s, st, 'walkout');
          else if (rand(s) < 0.1 * (c.sens?.wait ?? 1)) addReview(s, st, 1, 'walkout', false, { kind: c.kind, items: [], paid: 0, wait: Math.round(c.t), clean: Math.round(st.cleanliness), factors: [['Wait', -Math.round(c.t)]], who: c.sens?.label });
          leave(st, c, 'line', fc);
        }
        break;
      }
      case 'toSeat':
        if (c.t >= c.dur) {
          c.state = 'waitFood';
          c.t = 0;
        }
        break;
      case 'waitFood': {
        const o = st.orders.find((x) => x.id === c.orderId);
        if (!o) {
          leave(st, c, 'done', fc);
          break;
        }
        const wait = t - c.arrived;
        const f = wait / o.expected;
        c.mood = f < 0.7 ? 'happy' : f < 1.2 ? 'ok' : 'angry';
        if (wait > Math.max(o.expected * 2.5, (o.quote ?? 0) * 1.5 + 10) && o.state !== 'out') refund(s, st, o, c, fc);
        break;
      }
      case 'pickup':
        if (c.t >= c.dur) {
          const o = st.orders.find((x) => x.id === c.orderId);
          if (o) completeOrder(s, st, o, t - c.arrived, o.readyAt !== undefined ? t - o.readyAt - c.dur : 0);
          leave(st, c, 'done', fc);
        }
        break;
      case 'eating':
        c.mood = 'none';
        if (c.t >= (c.eatFor ?? 15)) leave(st, c, 'done', fc);
        break;
      case 'leave':
      case 'ordering':
        break;
    }
  }
  st.customers = st.customers.filter((c) => !(c.state === 'leave' && c.t >= c.dur));
  // delivery orders that waited far too long
  for (const o of st.orders) {
    if (o.kind === 'delivery' && (o.state === 'kitchen' || o.state === 'ready') && t - o.placed > o.expected * 2.5) refund(s, st, o, undefined, fc);
  }
}

function refund(s: GameState, st: Store, o: Order, c: Customer | undefined, fc: FloorConfig) {
  o.state = 'refunded';
  s.cash -= o.total;
  st.today.revenue -= o.total;
  s.stats.revenue -= o.total;
  st.today.refunds++;
  st.today.lost++;
  s.stats.lost++;
  st.orders = st.orders.filter((x) => x !== o);
  st.deliveryQueue = st.deliveryQueue.filter((id) => id !== o.id);
  rateLost(s, st, 0.015);
  if (c) {
    c.mood = 'angry';
    emit({ type: 'walkout', storeId: st.id, customerId: c.id, text: 'Refund!' });
    leave(st, c, 'refund', fc);
  }
  // free anyone working on it
  for (const x of st.staff) {
    const tk = x.task;
    if (tk && (tk.kind === 'prep' || tk.kind === 'run') && tk.orderId === o.id) x.task = null;
  }
  if (o.critic) criticVerdict(s, st, 'refund');
  else addReview(s, st, 1, 'refund', false, orderDetail(s, st, o, now(s) - o.placed));
  if (rand(s) < 0.4 || o.critic) news(s, `Refunded ${o.name}: waited too long${o.kind === 'delivery' ? ' for delivery' : ''}.`, 'bad');
}

// ------------------------------------------------------------------ staff tasks

function progressTasks(s: GameState, st: Store, dt: number, fc: FloorConfig) {
  for (const x of st.staff) {
    const task = x.task;
    if (!task || !x.onFloor) continue;
    task.remaining -= dt;
    const elapsed = task.total - task.remaining;
    if (task.kind === 'clean' && elapsed > task.travel) {
      const rate = 0.55 * staffSpeed(s, st, x) * (up(st, 'cleaning').cleanSpeed ?? 1) * (x.traits.includes('tidy') ? 2 : 1);
      st.cleanliness = clamp(st.cleanliness + rate * dt, 0, 100);
    }
    if (task.kind === 'deliver') x.roadMin = (x.roadMin ?? 0) + dt;
    if (task.kind === 'deliver' && !task.dropped && elapsed >= (task.dropAt ?? 0)) {
      task.dropped = true;
      for (const id of task.orderIds ?? []) {
        const o = st.orders.find((q) => q.id === id);
        if (!o) continue;
        completeOrder(s, st, o, now(s) - o.placed, 0);
        // tips (from the customer, not the store) and mileage (paid by the store, not labor)
        const late = now(s) - o.placed > (o.quote ?? 40) + 10;
        const tip = Math.round((late ? 1 + rand(s) * 2 : 2.5 + rand(s) * 4) * 4) / 4;
        x.tipsToday = (x.tipsToday ?? 0) + tip;
        st.today.tips = (st.today.tips ?? 0) + tip;
        st.today.mileage = (st.today.mileage ?? 0) + MILEAGE_PER_TRIP;
        st.today.other += MILEAGE_PER_TRIP;
        s.cash -= MILEAGE_PER_TRIP;
      }
    }
    if (task.remaining > 0) continue;
    x.task = null;
    if (task.kind !== 'walk') x.tasksToday++;
    gainXp(s, st, x, task.kind === 'walk' ? 0 : task.total - task.travel + (task.kind === 'deliver' ? task.total * 0.3 : 0));
    switch (task.kind) {
      case 'order': {
        const c = st.customers.find((q) => q.id === task.customerId);
        if (c && c.state === 'ordering') takeOrder(s, st, c, x, fc);
        break;
      }
      case 'prep': {
        const o = st.orders.find((q) => q.id === task.orderId);
        if (!o) break;
        const it = o.items[task.itemIdx ?? 0];
        if (!it || it.stage !== 'prep') break;
        if (rand(s) < dropChance(x)) {
          remakePizza(s, st, x, it, 'drop');
          break;
        }
        if (ITEM[it.item].type === 'pizza' && rand(s) < wrongToppingChance(x, it.item)) {
          remakePizza(s, st, x, it, 'wrong');
          break;
        }
        it.quality = pizzaQuality(s, st, it.item, x.skill, x.traits.includes('perfectionist'), x.energy);
        it.stage = ITEM[it.item].bake > 0 ? 'ovenWait' : 'done';
        it.progress = 0;
        break;
      }
      case 'run': {
        const o = st.orders.find((q) => q.id === task.orderId);
        const c = o ? st.customers.find((q) => q.id === o.customerId) : undefined;
        if (!o) break;
        if (!c || c.state !== 'waitFood') {
          st.orders = st.orders.filter((q) => q !== o);
          break;
        }
        const pizzas = o.items.filter((it) => ITEM[it.item].type !== 'drink');
        if (pizzas.length && rand(s) < dropChance(x) * 0.6) {
          remakePizza(s, st, x, pickOne(s, pizzas), 'drop');
          o.state = 'kitchen';
          break;
        }
        completeOrder(s, st, o, now(s) - c.arrived, o.readyAt !== undefined ? now(s) - o.readyAt : 0);
        c.state = 'eating';
        c.t = 0;
        c.eatFor = 12 + rand(s) * 10;
        break;
      }
      case 'bus': {
        const tb = task.table ?? 0;
        st.dirty = st.dirty.filter((seat) => Math.floor(seat / 2) !== tb);
        st.cleanliness = clamp(st.cleanliness + 1.5, 0, 100);
        break;
      }
      case 'walk':
        if (x.pos[0] === BACK_OUT[0] && x.pos[1] === BACK_OUT[1] && !onShiftNow(s, x)) x.onFloor = false;
        break;
      case 'deliver':
      case 'clean':
        break;
    }
  }
  // kiosks
  st.kiosks ??= [];
  for (let k = 0; k < st.kiosks.length; k++) {
    const kq = st.kiosks[k];
    if (!kq) continue;
    kq.remaining -= s.phase === 'prep' ? 0 : dt;
    if (kq.remaining <= 0) {
      const c = st.customers.find((q) => q.id === kq.customerId);
      st.kiosks[k] = null;
      if (c && c.state === 'ordering') takeOrder(s, st, c, null, fc);
    }
  }
}

const REMAKE_FLOAT: Record<RemakeReason, string> = { drop: 'Dropped!', wrong: 'Wrong toppings!', burnt: 'Burnt!' };

/** A pizza has to be made again: dropped, wrong toppings caught at the pass, or burnt in the oven. */
function remakePizza(s: GameState, st: Store, x: Staff | null, it: OrderItem, reason: RemakeReason) {
  it.stage = 'queued';
  it.progress = 0;
  st.today.drops++;
  const r = (st.today.remakes ??= {});
  r[reason] = (r[reason] ?? 0) + 1;
  if (x) x.dropsToday = (x.dropsToday ?? 0) + 1;
  if (itemAvailable(st, it.item, false)) st.today.foodCost += consumeItem(s, st, it.item, false);
  emit({ type: 'drop', storeId: st.id, text: REMAKE_FLOAT[reason], reason });
  const pizza = ITEM[it.item].name;
  const loud = (x?.traits.includes('clumsy') && reason === 'drop') || rand(s) < 0.3;
  if (!loud) return;
  const msg = reason === 'drop' ? `${x!.name} dropped a ${pizza}. Remaking it.`
    : reason === 'wrong' ? `${x!.name} mixed up the toppings on a ${pizza}. Caught at the pass, remaking it.`
    : `A ${pizza} stayed in the oven too long. Remaking it.`;
  news(s, msg, 'bad', false);
}

/** Chance a finished pizza comes out burnt: only when the oven is backed up and the cooks are green. */
function burnChance(s: GameState, st: Store): number {
  const cooks = st.staff.filter((x) => x.role === 'cook' && x.onFloor);
  const waiting = itemsInStage(st, 'ovenWait');
  const busy = clamp(waiting / Math.max(1, ovenSlots(st)), 0, 1);
  if (busy <= 0) return 0;
  const crew = cooks.length ? cooks.reduce((a, x) => a + mistakeMult(x), 0) / cooks.length : 1.2;
  void s;
  return 0.007 * busy * crew;
}

/** Minutes a new order would take right now, as quoted at the till. */
export function quotedWait(s: GameState, st: Store): number {
  let ahead = 0, oven = 0;
  for (const o of st.orders) {
    if (o.state !== 'kitchen') continue;
    for (const it of o.items) {
      if (it.stage === 'queued' || it.stage === 'prep') ahead++;
      if (it.stage === 'ovenWait' || it.stage === 'baking' || it.stage === 'queued' || it.stage === 'prep') oven++;
    }
  }
  const cooks = st.staff.filter((x) => x.role === 'cook' && x.onFloor);
  const hands = Math.min(up(st, 'prep').stations ?? 1, cooks.length) || 0.4;
  let speed = 0;
  for (const x of cooks) speed += staffSpeed(s, st, x);
  speed = cooks.length ? speed / cooks.length : 0.7;
  const prepRate = (hands * speed * (up(st, 'prep').speed ?? 1)) / 2.8;
  const bake = up(st, 'oven').bakeTime ?? 7;
  const ovenRate = ovenSlots(st) / bake;
  return Math.max(ahead / prepRate, oven / ovenRate) + bake + 4;
}

function takeOrder(s: GameState, st: Store, c: Customer, taker: Staff | null, fc: FloorConfig) {
  // a long quoted wait sends some people away before they pay (and before stock is used)
  const tolerance = (c.kind === 'dine' ? 30 : 24) * DIFFICULTY[s.difficulty].patience * (0.8 + rand(s) * 0.6);
  const quote = quotedWait(s, st);
  if (!c.critic && quote > tolerance && rand(s) < 0.75) {
    c.mood = 'angry';
    st.today.lost++;
    st.today.walkouts++;
    s.stats.lost++;
    rateLost(s, st, 0.002);
    emit({ type: 'walkout', storeId: st.id, customerId: c.id, text: `${Math.round(quote)} min wait?!` });
    leave(st, c, 'line', fc);
    return;
  }
  let kind = c.kind;
  let seat = -1;
  if (kind === 'dine') {
    seat = freeSeat(s, st);
    if (seat < 0) kind = 'takeout';
  }
  const upsell = taker?.traits.includes('upseller') ? 0.2 : 0;
  const items = buildItems(s, st, kind !== 'dine', upsell, false);
  if (!items) {
    c.mood = 'angry';
    st.today.lost++;
    st.today.soldOut++;
    s.stats.lost++;
    rateLost(s, st, 0.006);
    if (rand(s) < 0.25) addReview(s, st, 1.5, 'soldout');
    emit({ type: 'walkout', storeId: st.id, customerId: c.id, text: 'Sold out' });
    leave(st, c, 'soldout', fc);
    return;
  }
  const charm = (taker?.traits.includes('charming') ? 5 : 0) - (taker?.traits.includes('grumpy') ? 4 : 0) + (c.greeted ? 2 : 0);
  c.kind = kind;
  const o = createOrder(s, st, kind, items, c, charm);
  o.quote = quote;
  c.orderId = o.id;
  c.t = 0;
  c.state = 'toSeat';
  const from = c.pos;
  c.from = from;
  if (kind === 'dine') {
    c.seat = seat;
    const sp = seatPos(seat);
    c.pos = [sp.x, sp.z];
  } else {
    c.waitSpot = freeWaitSpot(st);
    c.pos = [...WAIT[c.waitSpot % WAIT.length]];
  }
  c.dur = walkC(fc, from, c.pos);
}

function prepStationsInUse(st: Store) {
  const used = new Set<number>();
  for (const x of st.staff) if (x.task?.kind === 'prep' && x.task.station !== undefined) used.add(x.task.station);
  return used;
}
function tillsInUse(st: Store) {
  const used = new Set<number>();
  for (const x of st.staff) if (x.task?.kind === 'order' && x.task.till !== undefined) used.add(x.task.till);
  return used;
}

function nextQueuedItem(st: Store): { o: Order; idx: number } | null {
  for (const o of st.orders) {
    if (o.state !== 'kitchen') continue;
    const idx = o.items.findIndex((it) => it.stage === 'queued');
    if (idx >= 0) return { o, idx };
  }
  return null;
}

/** Where someone on an idle walk counts as being now: whichever end they're nearer (always a real spot on the floor, never inside the counter). */
function idleWalkPos(x: Staff): P2 {
  const t = x.task!;
  const f = t.from ?? t.to;
  const k = t.total > 0 ? clamp(1 - t.remaining / t.total, 0, 1) : 1;
  return k < 0.5 ? [f[0], f[1]] : [t.to[0], t.to[1]];
}
/** A stroll that real work can interrupt: heading back to their spot, or over to say hi. */
function idleWalk(x: Staff, to: P2, fc: FloorConfig) {
  const from: P2 = [x.pos[0], x.pos[1]];
  give(x, 'walk', to, walkS(fc, from, to), 0, { idle: true, from });
}
const isIdleWalk = (x: Staff) => x.task?.kind === 'walk' && !!x.task.idle;

/** Cleanliness the team starts tidying at. In a lull they keep things nicer; mid-rush only a mess gets attention. */
export function cleanThreshold(lull: boolean) {
  return lull ? 84 : 68;
}

/** Where a spare front-of-house person waits: by the pass, ready to run plates. */
const FLOOR_WAIT: P2 = [1.55, -2.3];

const GREETINGS = ['Welcome in!', 'Hi there!', 'Be right with you!', 'Hey! Come on in!', 'Welcome!', "What'll it be?"];

function assignTasks(s: GameState, st: Store, fc: FloorConfig) {
  const queue = st.customers.filter((c) => c.state === 'queue').sort((a, b) => a.arrived - b.arrived);
  // people just through the door (the walk in from the sidewalk is mostly outside)
  const arriving = st.customers.filter((c) => c.state === 'enter' && c.t >= c.dur * 0.55);
  const lull = !queue.length && !arriving.length && !st.orders.some((o) => o.state === 'ready' && o.kind === 'dine');
  // after a "keep it cleaner" crew message, people tidy sooner for a day
  const needClean = st.cleanliness < cleanThreshold(lull) + (st.cleanFocusDay === s.day ? 8 : 0);
  // idle strolls give way to real work, but only for unclaimed work this person could pick up
  const unbused = new Set(st.dirty.map((seat) => Math.floor(seat / 2)));
  for (const y of st.staff) if (y.task?.kind === 'bus') unbused.delete(y.task.table ?? -1);
  const cleaning = st.staff.filter((y) => y.task?.kind === 'clean').length;
  const floorWork = queue.length > 0 || arriving.some((c) => !c.greeted) || unbused.size > 0 || (needClean && cleaning === 0)
    || st.orders.some((o) => o.state === 'ready' && o.kind === 'dine');
  const kitchenWork = st.orders.some((o) => o.state === 'kitchen' && o.items.some((it) => it.stage === 'queued'));
  for (const x of st.staff) {
    if (!isIdleWalk(x)) continue;
    const could = x.role === 'cook' ? kitchenWork || queue.length >= 3 : x.role === 'driver' ? st.deliveryQueue.length > 0 : floorWork;
    if (!could) continue;
    x.pos = idleWalkPos(x);
    x.task = null;
  }
  const free = st.staff.filter((x) => x.onFloor && !x.task && onShiftNow(s, x));
  if (!free.length) return;
  const regTime = up(st, 'register').orderTime ?? 1.6;
  const nTills = tills(st);
  const busyTills = tillsInUse(st);
  const busy = (x: Staff) => !!x.task;

  const startOrder = (x: Staff, speed: number): boolean => {
    if (!queue.length) return false;
    let till = -1;
    for (let i = 0; i < nTills; i++) if (!busyTills.has(i)) {
      till = i;
      break;
    }
    if (till < 0) return false;
    const c = queue.shift()!;
    busyTills.add(till);
    const custWalk = walkC(fc, c.pos[1] > 5 ? c.pos : QUEUE[0], tillCust(till));
    const staffWalk = walkS(fc, x.pos, tillStaff(till));
    const travel = Math.max(custWalk, staffWalk);
    const ringing = st.staff.filter((y) => (y.role === 'front' || y.role === 'manager') && y.onFloor).length;
    give(x, 'order', tillStaff(till), travel, (regTime * (x.traits.includes('multitasker') ? 0.8 : 1) * (1 - spareBonus(nTills - ringing))) / speed, { customerId: c.id, till });
    st.today.lineWaitSum += now(s) - c.arrived;
    st.today.lineWaitN++;
    c.state = 'ordering';
    c.mood = 'happy';
    c.till = till;
    c.t = 0;
    c.dur = custWalk;
    c.from = QUEUE[0];
    c.pos = tillCust(till);
    return true;
  };

  // self-order kiosks take the next in line when free
  st.kiosks ??= [];
  for (let k = 0; k < kioskCount(st) && queue.length; k++) {
    if (st.kiosks[k]) continue;
    const c = queue.shift()!;
    const spot = KIOSK_SPOTS[k];
    const walk = walkC(fc, QUEUE[0], spot);
    st.kiosks[k] = { customerId: c.id, remaining: walk + KIOSK_MIN };
    st.today.lineWaitSum += now(s) - c.arrived;
    st.today.lineWaitN++;
    c.state = 'ordering';
    c.mood = 'happy';
    c.till = -1 - k;
    c.t = 0;
    c.dur = walk;
    c.from = QUEUE[0];
    c.pos = [...spot];
  }

  const ready = st.orders.filter((o) => o.state === 'ready' && o.kind === 'dine' && st.customers.some((c) => c.id === o.customerId && c.state === 'waitFood'));
  const anyFront = st.staff.some((y) => (y.role === 'front' || y.role === 'manager') && y.onFloor && onShiftNow(s, y));

  const run = (x: Staff): boolean => {
    const o = ready.shift();
    if (!o) return false;
    const c = st.customers.find((q) => q.id === o.customerId)!;
    const table = Math.floor((c.seat ?? 0) / 2);
    const side = snap(fc, tableSide(table), false);
    const travel = walkS(fc, x.pos, PASS) + walkS(fc, PASS, side);
    give(x, 'run', side, travel, 0.15, { orderId: o.id, table, via: PASS });
    o.state = 'out';
    return true;
  };
  const bus = (x: Staff): boolean => {
    const tables = [...new Set(st.dirty.map((seat) => Math.floor(seat / 2)))].filter((tb) => !st.staff.some((y) => y.task?.kind === 'bus' && y.task.table === tb));
    if (!tables.length) return false;
    // nearest dirty table
    let best = tables[0], bd = Infinity;
    for (const tb of tables) {
      const p = tableSide(tb);
      const d = Math.hypot(p[0] - x.pos[0], p[1] - x.pos[1]);
      if (d < bd) {
        bd = d;
        best = tb;
      }
    }
    const side = snap(fc, tableSide(best), false);
    const speed = (up(st, 'cleaning').cleanSpeed ?? 1) * (x.traits.includes('tidy') ? 2 : 1) * staffSpeed(s, st, x);
    give(x, 'bus', side, walkS(fc, x.pos, side), 0.6 / speed, { table: best });
    return true;
  };
  const clean = (x: Staff): boolean => {
    if (!needClean) return false;
    // one person on the mop is plenty unless the place is a real mess
    if (st.staff.filter((y) => y.task?.kind === 'clean').length >= (st.cleanliness < 55 ? 2 : 1)) return false;
    const p = snap(fc, CLEAN_POINTS[Math.floor(rand(s) * CLEAN_POINTS.length)], false);
    give(x, 'clean', p, walkS(fc, x.pos, p), 1.5);
    return true;
  };

  // say hi to someone walking in, and head to a free till so they're ready when the customer gets there
  const greet = (x: Staff): boolean => {
    const c = arriving.find((q) => !q.greeted);
    if (!c) return false;
    c.greeted = true;
    // a friendly hello buys patience
    c.patience *= 1.2;
    emit({ type: 'greet', storeId: st.id, customerId: c.id, text: pickOne(s, GREETINGS) });
    let till = -1;
    for (let i = 0; i < nTills; i++) if (!busyTills.has(i)) {
      till = i;
      break;
    }
    if (till < 0) return false;
    const spot = tillStaff(till);
    const waiting = st.staff.some((y) => y !== x && y.onFloor && !y.task && Math.hypot(y.pos[0] - spot[0], y.pos[1] - spot[1]) < 0.4);
    if (waiting || Math.hypot(x.pos[0] - spot[0], x.pos[1] - spot[1]) < 0.4) return true;
    idleWalk(x, spot, fc);
    return true;
  };

  // Front of house. With more people than tills, the ones at the tills stay on them and the
  // spare person runs food, clears tables and does most of the cleaning. Who's who is worked out
  // fresh each moment from where people are, so if the runner ends up taking an order they simply
  // swap roles and carry on.
  const frontOn = st.staff.filter((y) => isFront(y) && y.onFloor && onShiftNow(s, y));
  const zoned = frontOn.length > nTills;
  const tillSpots = Array.from({ length: nTills }, (_, i) => tillStaff(i));
  const tillDist = (y: Staff) => (y.task?.kind === 'order' ? -1 : Math.min(...tillSpots.map((p) => Math.hypot(y.pos[0] - p[0], y.pos[1] - p[1]))));
  const tillCrew = new Set(zoned ? [...frontOn].sort((a, b) => tillDist(a) - tillDist(b)).slice(0, nTills) : frontOn);
  const floorFree = () => frontOn.some((y) => !tillCrew.has(y) && !y.task);
  for (const x of free) {
    if (busy(x) || !isFront(x)) continue;
    if (!zoned) {
      // short-handed: everyone does a bit of everything, food first (it's getting cold)
      if (run(x)) continue;
      if (startOrder(x, staffSpeed(s, st, x))) continue;
      if (bus(x)) continue;
      if (greet(x)) continue;
      clean(x);
      continue;
    }
    if (tillCrew.has(x)) {
      // on the till: take orders and greet people; only leave it when the food is piling up
      if (startOrder(x, staffSpeed(s, st, x))) continue;
      if (greet(x)) continue;
      if (ready.length >= 3 && !floorFree() && run(x)) continue;
      if (st.cleanliness < 55 && !floorFree()) clean(x);
      continue;
    }
    // floor crew: food out, tables cleared, floors clean; help on the tills only when the line is long
    if (run(x)) continue;
    if (bus(x)) continue;
    if (queue.length >= 3 && startOrder(x, staffSpeed(s, st, x))) continue;
    clean(x);
  }
  // managers run the shift rather than the till: they keep everyone moving (a speed lift for the
  // whole crew) and only jump on the line in a real crunch, a bit slower than a regular. Every
  // jump-in is counted; too many wear on their morale and show up in the end-of-day tip.
  const frontHere = st.staff.some((y) => y.role === 'front' && y.onFloor);
  for (const x of free) {
    if (busy(x) || x.role !== 'manager') continue;
    const crunch = !frontHere || queue.length >= 4 || ready.length >= 2;
    if (!crunch) continue;
    const jump = () => (st.today.mgrJumps = (st.today.mgrJumps ?? 0) + 1);
    if (ready.length && run(x)) { jump(); continue; }
    if (queue.length >= (frontHere ? 4 : 1) && startOrder(x, staffSpeed(s, st, x) * 0.85)) { jump(); continue; }
    if (!frontHere && bus(x)) jump();
  }
  // kitchen
  const stations = up(st, 'prep').stations ?? 1;
  const prepSpeed = up(st, 'prep').speed ?? 1;
  const inUse = prepStationsInUse(st);
  for (const x of free) {
    if (busy(x) || x.role !== 'cook') continue;
    const next = nextQueuedItem(st);
    // a cook covers the counter when nobody else can, or the line is long and the kitchen is clear
    if (!anyFront) {
      if (ready.length && (!next || ready.length >= 2) && run(x)) continue;
      if (queue.length && (!next || queue.length >= 3) && startOrder(x, staffSpeed(s, st, x) * 0.6)) continue;
    } else if (!next && queue.length >= 4 && startOrder(x, staffSpeed(s, st, x) * 0.6)) continue;
    if (!next || inUse.size >= stations) continue;
    let station = x.spot >= 0 && x.spot < stations && !inUse.has(x.spot) ? x.spot : -1;
    if (station < 0) {
      // closest free station
      let bd = Infinity;
      for (let i = 0; i < stations; i++) {
        if (inUse.has(i)) continue;
        const p = stationSpot(i);
        const d = Math.abs(p[0] - x.pos[0]) + Math.abs(p[1] - x.pos[1]);
        if (d < bd) {
          bd = d;
          station = i;
        }
      }
    }
    if (station < 0) continue;
    inUse.add(station);
    x.spot = station;
    const it = next.o.items[next.idx];
    it.stage = 'prep';
    const spot = stationSpot(station);
    const spare = stations - st.staff.filter((y) => y.role === 'cook' && y.onFloor).length;
    give(x, 'prep', spot, walkS(fc, x.pos, spot), (ITEM[it.item].prep * (1 - 0.8 * spareBonus(spare))) / (staffSpeed(s, st, x) * prepSpeed), { orderId: next.o.id, itemIdx: next.idx, station });
  }
  // drivers
  const cap = up(st, 'delivery').vehicleCap ?? 0;
  if (cap > 0) {
    for (const x of free) {
      if (busy(x) || x.role !== 'driver' || !st.deliveryQueue.length) continue;
      const ids = st.deliveryQueue.splice(0, cap);
      for (const id of ids) {
        const o = st.orders.find((q) => q.id === id);
        if (o) o.state = 'out';
      }
      const L = loc(st);
      const walk = walkS(fc, x.pos, PICKUP_STAFF) + walkS(fc, PICKUP_STAFF, BACK_OUT);
      const drive = ((13 + 5 * (ids.length - 1)) * L.deliveryDist * (up(st, 'delivery').vehicleSpeed ?? 1) * (x.traits.includes('navigator') ? 0.8 : 1)) / Math.max(0.6, staffSpeed(s, st, x));
      give(x, 'deliver', BACK_OUT, walk, drive, { orderIds: ids, dropAt: walk + drive * 0.55, dropped: false, via: PICKUP_STAFF });
      emit({ type: 'delivery', storeId: st.id });
    }
  }
  // anyone left standing outside (back from a delivery) comes back in
  for (const x of free) {
    if (busy(x) || x.pos[0] !== BACK_OUT[0] || x.pos[1] !== BACK_OUT[1]) continue;
    const home = homeSpot(st, x, fc);
    give(x, 'walk', home, walkS(fc, x.pos, home), 0);
  }
  // nothing to do: head back to their spot instead of standing by a table (a manager at the till
  // or anyone already at a till with someone walking in stays put)
  for (const x of free) {
    // cooks stay at their station between pizzas; drivers wait by the door already
    if (busy(x) || (x.role !== 'front' && x.role !== 'manager')) continue;
    let home = homeSpot(st, x, fc);
    if (isFront(x) && zoned) {
      // till crew wait at a till; the floor person waits by the pass, ready to run food
      if (tillCrew.has(x)) {
        const free = tillSpots.filter((p) => !frontOn.some((y) => y !== x && tillCrew.has(y) && Math.hypot(y.pos[0] - p[0], y.pos[1] - p[1]) < 0.4));
        home = (free.length ? free : tillSpots).reduce((a, p) => (Math.hypot(x.pos[0] - p[0], x.pos[1] - p[1]) < Math.hypot(x.pos[0] - a[0], x.pos[1] - a[1]) ? p : a));
      } else home = snap(fc, FLOOR_WAIT, false);
    }
    if (Math.hypot(x.pos[0] - home[0], x.pos[1] - home[1]) < 0.6) continue;
    if (arriving.length && isFront(x) && [...Array(nTills).keys()].some((i) => Math.hypot(x.pos[0] - tillStaff(i)[0], x.pos[1] - tillStaff(i)[1]) < 0.4)) continue;
    idleWalk(x, home, fc);
  }
}

// ------------------------------------------------------------------ ovens & orders

export function ovenSlots(st: Store) {
  return Math.max(1, (up(st, 'oven').slots ?? 2) - st.ovenPenalty);
}

function updateOvens(s: GameState, st: Store, dt: number) {
  const slots = ovenSlots(st);
  const bakeTime = up(st, 'oven').bakeTime ?? 7;
  let baking = 0;
  for (const o of st.orders) for (const it of o.items) if (it.stage === 'baking') baking++;
  for (const o of st.orders) {
    for (const it of o.items) {
      if (it.stage === 'baking') {
        it.progress += dt / (bakeTime * ITEM[it.item].bake);
        if (it.progress >= 1) {
          baking--;
          if (ITEM[it.item].type === 'pizza' && rand(s) < burnChance(s, st)) {
            remakePizza(s, st, null, it, 'burnt');
            continue;
          }
          it.progress = 1;
          it.stage = 'done';
        }
      }
    }
  }
  if (baking < slots) {
    for (const o of st.orders) {
      for (const it of o.items) {
        if (baking >= slots) return;
        if (it.stage === 'ovenWait') {
          it.stage = 'baking';
          it.progress = 0;
          baking++;
        }
      }
    }
  }
}

function checkOrders(s: GameState, st: Store, fc: FloorConfig) {
  const t = now(s);
  for (const o of [...st.orders]) {
    if (o.state === 'kitchen') {
      if (!o.items.every((it) => it.stage === 'done')) continue;
      o.state = 'ready';
      o.readyAt = t;
      if (o.kind === 'delivery') {
        st.deliveryQueue.push(o.id);
        continue;
      }
    }
    if (o.state !== 'ready' || o.kind === 'delivery') continue;
    const c = st.customers.find((q) => q.id === o.customerId);
    if (!c || c.state === 'leave') {
      st.orders = st.orders.filter((x) => x !== o);
      continue;
    }
    // takeout customers walk over to the shelf to collect
    if (o.kind === 'takeout' && c.state === 'waitFood') {
      o.state = 'out';
      c.state = 'pickup';
      c.t = 0;
      c.from = c.pos;
      c.dur = walkC(fc, c.pos, PICKUP_CUST) + 0.2;
      c.pos = [...PICKUP_CUST];
    }
  }
}

/** Debug hook for balance scripts. */
export const satLog: { kind: string; wait: number; cold: number; q: number; sat: number; clean: number; dirty: number }[] = [];
export let satLogOn = false;
export const setSatLog = (v: boolean) => (satLogOn = v);

function completeOrder(s: GameState, st: Store, o: Order, waitMin: number, coldMin: number) {
  o.state = 'done';
  st.orders = st.orders.filter((x) => x !== o);
  const r = satisfaction(s, st, o, waitMin, o.kind === 'delivery' ? 0 : coldMin);
  if (satLogOn) satLog.push({ kind: o.kind, wait: (now(s) - o.placed) - (o.quote ?? 0), cold: coldMin, q: o.items.reduce((a, it) => a + it.quality, 0) / o.items.length, sat: r.sat, clean: st.cleanliness, dirty: st.dirty.length });
  const w = 0.02;
  st.rating = clamp(st.rating + (r.stars - st.rating) * w, 1, 5);
  st.today.served++;
  st.today.servedByHour[hourIdx(s)]++;
  st.today.satSum += r.sat;
  st.today.satCount++;
  st.today.serviceSum += now(s) - o.placed;
  st.today.serviceN++;
  s.stats.served++;
  if (o.kind === 'delivery') {
    st.today.deliveries++;
    s.stats.deliveries++;
  }
  const decay = up(st, 'cleaning').decay ?? 1;
  st.cleanliness = clamp(st.cleanliness - (o.kind === 'dine' ? 0.8 : o.kind === 'takeout' ? 0.4 : 0) * decay, 0, 100);
  addXp(s, 1 + (r.stars >= 3.5 ? 1 : 0) + (r.stars >= 4.5 ? 1 : 0));
  const detail = orderDetail(s, st, o, waitMin, r);
  const c = st.customers.find((q) => q.id === o.customerId);
  if (o.critic) criticVerdict(s, st, 'served', o, r, c?.arrived);
  else if (rand(s) < reviewChance(r.stars, o.sens)) addReview(s, st, r.stars, r.topic, false, detail, r.second);
  if (c) c.mood = r.stars >= 3.5 ? 'happy' : r.stars >= 2.5 ? 'ok' : 'angry';
  emit({ type: 'served', storeId: st.id, customerId: o.customerId, stars: r.stars });
  if (hasManager(st) && rand(s) < 0.001) news(s, 'Your manager reorganized the walk-in. Everything runs smoother.', 'info', false);
}

/** Detail card for an order (what the reviewer ordered, waited and paid). */
export function orderDetail(s: GameState, st: Store, o: Order, wait: number, r?: { quality: number; priceRatio: number; factors: [string, number][] }): ReviewDetail {
  return { kind: o.kind, items: o.items.map((it) => ITEM[it.item].name), paid: o.total, wait: Math.round(wait), quote: o.quote ? Math.round(o.quote) : undefined, quality: r ? Math.round(r.quality) : undefined, priceRatio: r?.priceRatio, clean: Math.round(st.cleanliness), factors: r?.factors, who: o.sens?.label };
}

function fillLine(s: GameState, line: string, d?: ReviewDetail) {
  const pizza = d?.items.find((n) => n !== 'Soda') ?? 'pizza';
  return line.replace(/\{item\}/g, pizza).replace(/\{wait\}/g, String(Math.max(1, d?.wait ?? 20))).replace(/\{price\}/g, d ? money(d.paid) : 'that');
}

export function addReview(s: GameState, st: Store, stars: number, topic: ReviewTopic, critic = false, detail?: ReviewDetail, second?: ReviewTopic) {
  const band = Math.max(0, Math.min(4, Math.round(stars) - 1));
  const recent = new Set(st.reviews.slice(0, 12).map((r) => r.text));
  let text = '';
  for (let tries = 0; tries < 5; tries++) {
    const parts: string[] = [];
    const open = REVIEW_OPEN[band][Math.floor(rand(s) * REVIEW_OPEN[band].length)];
    if (open && rand(s) < 0.6) parts.push(open);
    const lines = REVIEW_LINES[topic];
    parts.push(fillLine(s, lines[Math.floor(rand(s) * lines.length)], detail));
    if (second && rand(s) < 0.7) {
      const l2 = REVIEW_LINES[second];
      parts.push(fillLine(s, l2[Math.floor(rand(s) * l2.length)], detail));
    }
    const close = REVIEW_CLOSE[band][Math.floor(rand(s) * REVIEW_CLOSE[band].length)];
    if (close && rand(s) < 0.45) parts.push(close);
    text = parts.join(' ');
    if (!recent.has(text)) break;
  }
  st.reviews.unshift({ day: s.day, name: critic ? 'Food critic, The Daily Crust' : randomName(s), stars: Math.round(stars * 2) / 2, topic, text, critic, detail });
  if (st.reviews.length > 40) st.reviews.length = 40;
  emit({ type: 'review', storeId: st.id, stars, text });
}

export function itemsInStage(st: Store, stage: OrderItem['stage']) {
  let n = 0;
  for (const o of st.orders) for (const it of o.items) if (it.stage === stage) n++;
  return n;
}

/** Live service snapshot for the floor card: how many are waiting at each stage. */
export function serviceSnapshot(st: Store) {
  let line = 0, ordering = 0, seated = 0;
  for (const c of st.customers) {
    if (c.state === 'queue' || c.state === 'enter') line++;
    else if (c.state === 'ordering') ordering++;
    else if (c.state === 'waitFood' || c.state === 'toSeat') seated++;
  }
  const toMake = itemsInStage(st, 'queued');
  const making = itemsInStage(st, 'prep');
  const ovenWait = itemsInStage(st, 'ovenWait');
  const baking = itemsInStage(st, 'baking');
  let toRun = 0, toDeliver = 0;
  for (const o of st.orders) {
    if (o.state === 'ready' && o.kind === 'dine') toRun++;
    if (o.state === 'ready' && o.kind === 'delivery') toDeliver++;
  }
  return { line, ordering, seated, toMake, making, ovenWait, baking, toRun, toDeliver, dirty: new Set(st.dirty.map((x) => Math.floor(x / 2))).size };
}

export { ROLES, SHIFTS };
export type { ItemId };

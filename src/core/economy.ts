// Demand, pricing, quality and satisfaction formulas.
import { ING, ITEM, MENU, SUPPLIERS, ingredientCost, type IngId, type ItemId } from '../data/catalog';
import { CAMPAIGN, DAY_TRAFFIC, HOUR_CURVES, LOYALTY, OPEN_MIN, SPECIAL_WINDOWS, WEATHER, type WeatherId } from '../data/world';
import type { GameState, Order, Special, Store } from './types';
import { DIFFICULTY, loc, onMenu, up } from './state';
export type { WeatherId };
import { clamp, gauss, rand } from './util';

/**
 * Time of day prices are quoted for (specials can run lunch-only or dinner-only).
 * The sim moves it every step; panels read whatever time the game is at.
 */
let priceClock = OPEN_MIN;
export function setPriceClock(minute: number) {
  priceClock = minute;
}

/** The special running on an item at a given minute, if any. */
export function activeSpecial(st: Store, id: ItemId, minute = priceClock): Special | null {
  for (const sp of st.specials) {
    if (sp.id !== id) continue;
    const w = SPECIAL_WINDOWS[sp.window];
    if (minute >= w.start && minute < w.end) return sp;
  }
  return null;
}

/** Effective sale price (coupon days and specials discount it). */
export function salePrice(st: Store, id: ItemId, minute = priceClock) {
  let p = st.menu[id].price;
  const sp = activeSpecial(st, id, minute);
  if (sp) p *= 1 - sp.pct / 100;
  for (const c of st.campaigns) {
    const m = CAMPAIGN[c.id].priceMult;
    if (m) p *= m;
  }
  return Math.round(p * 100) / 100;
}

/** How much customers here care about price (location x difficulty). */
export function priceSensitivity(s: GameState, st: Store) {
  return loc(st).priceSens * DIFFICULTY[s.difficulty].priceSens;
}

/**
 * What customers think an item is worth today, and why. Starts from the recipe's base price, then:
 * the neighborhood, your ingredients and oven, your reputation, the weather (cold drinks on a hot day),
 * and big crowds in town. Charging above it costs orders and annoys people; below it brings them in.
 */
export function fairPrice(s: GameState, st: Store, id: ItemId, weather: WeatherId = s.weather): { price: number; parts: [string, number][] } {
  const def = ITEM[id];
  const parts: [string, number][] = [];
  const add = (label: string, m: number) => {
    if (Math.abs(m - 1) >= 0.005) parts.push([label, m]);
  };
  add(`${loc(st).name} prices`, loc(st).priceLevel ?? 1);
  if (def.type !== 'drink') {
    const q = SUPPLIERS[st.supplier].quality;
    add(q > 0 ? 'Premium ingredients' : 'Budget ingredients', 1 + q * 0.007);
    const oven = up(st, 'oven').quality ?? 0;
    add('Oven quality', 1 + oven * 0.004);
  }
  add(st.rating >= 3 ? 'Your reputation' : 'Poor reputation', 1 + (st.rating - 3) * 0.04);
  if (def.type === 'drink') add(weather === 'hot' ? 'Heatwave: everyone is thirsty' : weather === 'sunny' ? 'Sunny day' : weather === 'rainy' ? 'Rainy day' : '', weather === 'hot' ? 1.3 : weather === 'sunny' ? 1.06 : weather === 'rainy' ? 0.95 : 1);
  const crowd = s.effects.some((e) => e.kind === 'traffic' && e.mult >= 1.25 && (e.storeId === null || e.storeId === st.id));
  if (crowd) add('Big crowds in town', 1.06);
  let m = 1;
  for (const [, v] of parts) m *= v;
  return { price: def.fair * m, parts: parts.filter(([l]) => l) };
}

/** How attractive an item's price is: 1 at the fair price, lower when expensive. */
export function priceWeight(s: GameState, st: Store, id: ItemId) {
  const ratio = salePrice(st, id) / fairPrice(s, st, id).price;
  return clamp(Math.exp(-2.4 * (ratio - 1) * priceSensitivity(s, st)), 0.15, 1.8);
}

/** Popularity boost from a special: deeper discounts sell more. */
export const specialAppeal = (pct: number) => 1 + pct * 0.04;

export function ingredientPrice(s: GameState, st: Store, ing: IngId) {
  let m = s.market[ing] * SUPPLIERS[st.supplier].priceMult * DIFFICULTY[s.difficulty].ingredients;
  for (const e of s.effects) if (e.kind === 'price' && e.ing === ing) m *= e.mult;
  return ING[ing].cost * m;
}

export function itemFoodCost(s: GameState, st: Store, id: ItemId) {
  return ingredientCost(ITEM[id], (k) => ingredientPrice(s, st, k) / ING[k].cost);
}

export function marketingBoost(st: Store) {
  let b = 0;
  for (const c of st.campaigns) b += CAMPAIGN[c.id].boost;
  return Math.min(1.3, b);
}
export function deliveryMarketing(st: Store) {
  let b = 0;
  for (const c of st.campaigns) b += CAMPAIGN[c.id].deliveryBoost ?? 0;
  return b;
}

export function ratingFactor(r: number) {
  return 0.35 + 0.28 * r;
}

/** Combined effect of menu prices and variety on traffic. */
export function menuFactor(s: GameState, st: Store) {
  let wSum = 0, pw = 0, pizzas = 0;
  for (const m of MENU) {
    if (m.type !== 'pizza' || !onMenu(s, st, m.id)) continue;
    pizzas++;
    wSum += m.appeal;
    pw += m.appeal * priceWeight(s, st, m.id);
  }
  if (!pizzas) return 0;
  const price = clamp(Math.pow(pw / wSum, 0.6), 0.45, 1.35);
  const variety = Math.min(1.25, 0.85 + 0.06 * pizzas);
  const deals = st.specials.filter((sp) => onMenu(s, st, sp.id) && activeSpecial(st, sp.id)).length;
  return price * variety * (1 + 0.025 * deals);
}

export function effectMult(s: GameState, st: Store, kind: 'traffic' | 'dinner') {
  let m = 1;
  for (const e of s.effects) if (e.kind === kind && (e.storeId === null || e.storeId === st.id)) m *= e.mult;
  return m;
}

export interface RateCtx {
  day: number;
  minute: number;
  weather: WeatherId;
  /** Effects active on that day (defaults to today's). */
  effects?: GameState['effects'];
}
const ctxNow = (s: GameState): RateCtx => ({ day: s.day, minute: s.minute, weather: s.weather });

function effMult(s: GameState, st: Store, kind: 'traffic' | 'dinner', list: GameState['effects']) {
  let m = 1;
  for (const e of list) if (e.kind === kind && (e.storeId === null || e.storeId === st.id)) m *= e.mult;
  return m;
}

/** Walk-in customers per hour (now, or at another time/day for forecasts). */
export function walkInRate(s: GameState, st: Store, at: RateCtx = ctxNow(s)) {
  const L = loc(st);
  const hourIdx = Math.floor((at.minute - OPEN_MIN) / 60);
  if (hourIdx < 0 || hourIdx > 11) return 0;
  const curve = HOUR_CURVES[L.curve][hourIdx];
  const dow = (at.day - 1) % 7;
  let dayMult = DAY_TRAFFIC[dow];
  if (dow >= 4) dayMult *= L.weekendBoost;
  const w = WEATHER[at.weather].walk;
  const weather = 1 + (w - 1) * L.weatherSens;
  let r = L.traffic * curve * dayMult * weather * ratingFactor(st.rating);
  r *= 1 + marketingBoost(st) + (up(st, 'sign').traffic ?? 0) + (s.loyalty ? LOYALTY.boost : 0) + (st.fameBonus ?? 0);
  r *= menuFactor(s, st);
  const fx = at.effects ?? s.effects;
  r *= effMult(s, st, 'traffic', fx);
  if (at.minute >= 17 * 60) r *= effMult(s, st, 'dinner', fx);
  return r;
}

export function deliveryRate(s: GameState, st: Store, hasDriver: boolean, at: RateCtx = ctxNow(s)) {
  if (st.upgrades.delivery < 1 || !hasDriver) return 0;
  if (st.deliveryOff) return 0;
  const L = loc(st);
  if (L.deliveryShare <= 0) return 0;
  const hourIdx = Math.floor((at.minute - OPEN_MIN) / 60);
  if (hourIdx < 0 || hourIdx > 11) return 0;
  const curve = HOUR_CURVES[L.curve][hourIdx];
  const dow = (at.day - 1) % 7;
  let r = L.traffic * curve * DAY_TRAFFIC[dow] * L.deliveryShare * ratingFactor(st.rating);
  r *= up(st, 'online').onlineMult ?? 1;
  r *= WEATHER[at.weather].delivery;
  r *= 1 + marketingBoost(st) * 0.5 + deliveryMarketing(st) + (s.loyalty ? LOYALTY.boost : 0);
  r *= menuFactor(s, st);
  const fx = at.effects ?? s.effects;
  r *= effMult(s, st, 'traffic', fx);
  if (at.minute >= 17 * 60) r *= effMult(s, st, 'dinner', fx);
  // a new delivery service builds up over the first few days
  if (st.deliverySince !== undefined) r *= Math.min(1, 0.4 + 0.15 * Math.max(0, at.day - st.deliverySince));
  return r;
}

/** Relative popularity of each pizza on the menu right now. */
export function pizzaWeights(s: GameState, st: Store): { id: ItemId; w: number }[] {
  const L = loc(st);
  const opts: { id: ItemId; w: number }[] = [];
  for (const m of MENU) {
    if (m.type !== 'pizza' || !onMenu(s, st, m.id)) continue;
    const sp = activeSpecial(st, m.id);
    const w = m.appeal * (L.prefs[m.id] ?? 1) * priceWeight(s, st, m.id) * (sp ? specialAppeal(sp.pct) : 1);
    opts.push({ id: m.id, w });
  }
  return opts;
}

/** Pick a pizza for a customer from what's on the menu (ignores stock). */
export function choosePizza(s: GameState, st: Store): ItemId | null {
  const opts = pizzaWeights(s, st);
  let total = 0;
  for (const o of opts) total += o.w;
  if (!total) return null;
  let r = rand(s) * total;
  for (const o of opts) {
    r -= o.w;
    if (r <= 0) return o.id;
  }
  return opts[opts.length - 1].id;
}

export function pizzaQuality(s: GameState, st: Store, id: ItemId, cookSkill: number, perfectionist: boolean, energy: number) {
  let q = 52 + ITEM[id].craft;
  q += SUPPLIERS[st.supplier].quality;
  q += cookSkill * 5;
  if (perfectionist) q += 6;
  q += up(st, 'oven').quality ?? 0;
  if (energy < 25) q -= 8;
  q += gauss(s) * 4;
  return clamp(q, 5, 100);
}

export interface SatResult {
  sat: number;
  stars: number;
  topic: import('../data/text').ReviewTopic;
  /** The next strongest reason, if it points the same way. */
  second?: import('../data/text').ReviewTopic;
  quality: number;
  priceRatio: number;
  factors: [string, number][];
}

/** Satisfaction for a completed order. coldMin = minutes the food sat before reaching the customer. */
export function satisfaction(s: GameState, st: Store, o: Order, waitMin: number, coldMin = 0): SatResult {
  let quality = 0, n = 0, priceRatio = 0;
  let priceN = 0;
  for (const it of o.items) {
    const def = ITEM[it.item];
    if (def.type === 'pizza' || def.type === 'side') {
      // last-day ingredients taste a little tired
      quality += it.quality - (it.stale ? 5 : 0);
      n++;
    }
    priceRatio += salePrice(st, it.item) / fairPrice(s, st, it.item).price;
    priceN++;
  }
  // everyone has their own idea of a fair price: some shrug at a markup, some won't
  const tolerance = 1 + gauss(s) * 0.08;
  quality = n ? quality / n : 60;
  // food that sits on the pass goes cold
  if (coldMin > 3) quality -= Math.min(15, (coldMin - 3) * 1.5);
  priceRatio = priceN ? priceRatio / priceN : 1;
  let sat = 60 + (quality - 60) * 0.65;
  const contribs: { t: SatResult['topic']; v: number }[] = [];
  contribs.push({ t: quality >= 72 ? 'tasty' : 'bland', v: (quality - 60) * 0.65 });
  // a customer who accepted a long quoted wait expects some of it
  const expect = o.quote && o.quote > o.expected ? o.expected + (o.quote - o.expected) * 0.6 : o.expected;
  const over = waitMin - expect;
  const sens = o.sens ?? { clean: 1, wait: 1, price: 1 };
  // people in a hurry hate waiting; easygoing ones barely notice
  const waitEff = over > 0 ? -Math.min(35 * sens.wait, over * 1.7 * sens.wait) : waitMin < expect * 0.65 ? 6 : 0;
  sat += waitEff;
  contribs.push({ t: o.kind === 'delivery' ? (waitEff < 0 ? 'deliverySlow' : 'deliveryFast') : waitEff < 0 ? 'slow' : 'fast', v: waitEff });
  let priceEff = 0;
  const felt = priceRatio / tolerance;
  if (felt > 1.02) priceEff = -(felt - 1.02) * 70 * priceSensitivity(s, st) * sens.price;
  else if (felt < 0.92) priceEff = Math.min(8, (0.92 - felt) * 40 + 3);
  sat += priceEff;
  contribs.push({ t: priceEff < 0 ? 'pricey' : 'value', v: priceEff });
  if (o.kind !== 'delivery') {
    // 85%+ clean earns everyone full marks. Below that, how much it costs depends on who's
    // eating: a neat freak notices every crumb, plenty of people barely look up.
    const short = Math.max(0, 85 - st.cleanliness) * 0.3 + (o.kind === 'dine' ? st.dirty.length * 1.5 : 0);
    const clean = 7.5 - short * sens.clean;
    sat += clean;
    if (short * sens.clean > 4) contribs.push({ t: 'dirty', v: -short * sens.clean });
  }
  const amb = up(st, 'decor').ambience ?? 0;
  const ambEff = o.kind === 'dine' ? amb * 3 : o.kind === 'takeout' ? amb : 0;
  sat += ambEff;
  if (ambEff >= 6) contribs.push({ t: 'vibe', v: ambEff * 0.8 });
  sat += o.charm;
  sat += gauss(s) * 5;
  sat = clamp(sat, 0, 100);
  const stars = clamp(1 + sat / 25, 1, 5);
  // pick review topics: strongest effects in the direction of the verdict
  const positive = stars >= 3.5;
  const ranked = [...contribs].sort((a, b) => (positive ? b.v - a.v : a.v - b.v));
  const best = ranked[0];
  const second = ranked[1] && (positive ? ranked[1].v > 3 : ranked[1].v < -3) ? ranked[1].t : undefined;
  const LABEL: Record<string, string> = { tasty: 'Food', bland: 'Food', slow: 'Wait', fast: 'Wait', deliverySlow: 'Delivery time', deliveryFast: 'Delivery time', pricey: 'Price', value: 'Price', dirty: 'Cleanliness', vibe: 'Atmosphere' };
  const factors = contribs.filter((c) => Math.abs(c.v) >= 1).map((c) => [LABEL[c.t] ?? c.t, Math.round(c.v)] as [string, number]);
  return { sat, stars, topic: best.t, second, quality, priceRatio: felt, factors };
}

/** Daily random walk for wholesale prices. */
export function updateMarket(s: GameState) {
  for (const k of Object.keys(s.market) as IngId[]) {
    let m = s.market[k] * Math.exp(gauss(s) * 0.04);
    m += (1 - m) * 0.15;
    s.market[k] = clamp(m, 0.75, 1.45);
  }
}

export function customerPatience(s: GameState, st: Store) {
  const base = 14 * loc(st).patience * DIFFICULTY[s.difficulty].patience;
  const decor = 1 + (up(st, 'decor').ambience ?? 0) * 0.05;
  return base * decor * (0.7 + rand(s) * 0.6);
}

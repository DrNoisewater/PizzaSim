// Supply shortages, described one way everywhere (calendar, stock, receipt, prep card):
// is it coming or happening now, which days, how much more it costs, and what to do.
import { ING, type IngId } from '../data/catalog';
import type { GameState, Store } from './types';
import { storageCap, storageTomorrow, storageUsed, up } from './state';
import { estimateDailyNeed } from './inventory';
import { ingredientPrice } from './economy';

export interface Shortage {
  ing: IngId;
  /** Price increase in percent. */
  pct: number;
  phase: 'coming' | 'now';
  /** First and last day of the higher price. */
  start: number;
  end: number;
  /** Days until it starts (coming) or days left including today (now). */
  inDays: number;
  left: number;
}

/** All shortages announced or underway, soonest first. */
export function shortages(s: GameState): Shortage[] {
  const out: Shortage[] = [];
  for (const e of s.effects) {
    if (e.kind !== 'price' || !e.ing) continue;
    const total = e.total ?? e.daysLeft;
    const end = s.day + e.daysLeft - 1;
    out.push({ ing: e.ing, pct: Math.round((e.mult - 1) * 100), phase: 'now', start: e.since ?? end - total + 1, end, inDays: 0, left: e.daysLeft });
  }
  for (const u of s.upcoming) {
    if (u.kind !== 'shortage' || !u.ing) continue;
    const days = u.days ?? 3;
    out.push({ ing: u.ing, pct: Math.round(((u.mult ?? 1.8) - 1) * 100), phase: 'coming', start: u.day, end: u.day + days - 1, inDays: u.day - s.day, left: days });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const shortageFor = (s: GameState, ing: IngId) => shortages(s).find((x) => x.ing === ing) ?? null;

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** How long the ingredient keeps in this store's storage. */
const keeps = (st: Store | null, ing: IngId) => ING[ing].shelf + (st ? up(st, 'storage').shelfBonus ?? 0 : 0);

/** A few words for a chip or a calendar cell. */
export function shortageChip(s: GameState, x: Shortage): string {
  const n = ING[x.ing].name;
  if (x.phase === 'now') return `${n} shortage: ${days(x.left)} left`;
  if (x.inDays <= 1) return `${n} shortage tomorrow`;
  return `${n} shortage in ${days(x.inDays)}`;
}

/** The full sentence: what, when, how much, and what to do about it right now. */
export function shortageAdvice(s: GameState, x: Shortage, st: Store | null = null): string {
  const n = ING[x.ing].name;
  const span = x.start === x.end ? `day ${x.start}` : `days ${x.start}–${x.end}`;
  const k = keeps(st, x.ing);
  const report = s.phase === 'report';
  if (x.phase === 'now') {
    return `${n} shortage now: +${x.pct}% until the end of day ${x.end} (${days(x.left)} left, counting today). Buy only what you need until it's over.`;
  }
  // when is the last chance to buy at the normal price?
  const lastBuy = x.start - 1;
  const canKeep = k >= x.end - lastBuy + 1;
  const store = canKeep ? `It keeps ${days(k)}, long enough to stock up for the whole shortage.` : `It keeps ${days(k)}, so stock up for the first ${days(Math.max(1, k - 1))} and buy the rest as you go.`;
  // orders are priced when you place them, so the evening before still counts
  if (lastBuy === s.day && !report) return `${n} shortage starts tomorrow (+${x.pct}%, ${span}). Today is the last day to buy at the normal price: add extra to this morning's order, or order tonight after close. ${store}`;
  if (lastBuy === s.day && report) return `${n} shortage starts tomorrow (+${x.pct}%, ${span}). Tonight is your last chance at the normal price: order extra in Stock now and it arrives tomorrow morning. ${store}`;
  if (lastBuy === s.day + 1 && report) return `${n} shortage starts the day after tomorrow (+${x.pct}%, ${span}). Tomorrow is the last day to buy at the normal price: add extra to the morning truck. ${store}`;
  if (lastBuy < s.day) return `${n} shortage starts tomorrow (+${x.pct}%, ${span}). It's too late to buy at the normal price, so order only what you need.`;
  return `${n} shortage coming in ${days(x.inDays)} (+${x.pct}%, ${span}). Buy extra the morning before it starts (day ${lastBuy}). ${store}`;
}

/** Calendar entries for one day: the last day to stock up, then each day of the shortage. */
export function shortageCalendar(s: GameState, day: number): { label: string; tone: 'bad' | 'warn' }[] {
  const out: { label: string; tone: 'bad' | 'warn' }[] = [];
  for (const x of shortages(s)) {
    const n = ING[x.ing].name;
    if (day === x.start - 1 && day >= s.day) out.push({ label: `Last day to buy ${n.toLowerCase()} at the normal price (shortage starts tomorrow)`, tone: 'warn' });
    if (day >= x.start && day <= x.end) out.push({ label: `${n} shortage, day ${day - x.start + 1} of ${x.end - x.start + 1}: +${x.pct}% price`, tone: 'bad' });
  }
  return out;
}

/**
 * How much extra to buy now so the shortage days are covered at today's price: the daily need
 * for each shortage day the stock will keep for, minus nothing (today's order covers today).
 * Capped by free cold storage. Only offered while the normal price still applies.
 */
export function stockUpPlan(s: GameState, st: Store, x: Shortage): { qty: number; cost: number; days: number } | null {
  if (x.phase !== 'coming' || x.start - 1 < s.day) return null;
  const arrives = s.phase === 'prep' ? s.day : s.day + 1;
  const k = keeps(st, x.ing);
  // stock bought now lasts through day arrives + k - 1
  const lastCovered = Math.min(x.end, arrives + k - 1);
  const days = lastCovered - x.start + 1;
  if (days <= 0) return null;
  const daily = estimateDailyNeed(s, st, x.ing, 'tomorrow');
  let qty = Math.ceil((daily * days) / 5) * 5;
  const room = storageCap(st) - (s.phase === 'prep' ? storageUsed(st) : storageTomorrow(st, s.day));
  const space = ING[x.ing].space;
  if (space > 0) qty = Math.min(qty, Math.floor(Math.max(0, room) / space / 5) * 5);
  if (qty <= 0) return null;
  return { qty, cost: ingredientPrice(s, st, x.ing) * qty, days };
}

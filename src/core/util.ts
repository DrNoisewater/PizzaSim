// Seeded RNG, id allocation, event outbox and formatting helpers.
import type { GameState, SimEvent, NewsItem } from './types';

/** mulberry32 step stored on the state so runs are reproducible from a save. */
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (s: GameState, a: number, b: number) => a + (b - a) * rand(s);
export const randInt = (s: GameState, a: number, b: number) => Math.floor(a + (b - a + 1) * rand(s));
export function pickOne<T>(s: GameState, arr: readonly T[]): T {
  return arr[Math.floor(rand(s) * arr.length) % arr.length];
}
export function weighted<T>(s: GameState, items: { v: T; w: number }[]): T | null {
  let total = 0;
  for (const it of items) total += Math.max(0, it.w);
  if (total <= 0) return null;
  let r = rand(s) * total;
  for (const it of items) {
    r -= Math.max(0, it.w);
    if (r <= 0) return it.v;
  }
  return items[items.length - 1].v;
}
/** Standard-normal-ish (sum of uniforms). */
export function gauss(s: GameState): number {
  return (rand(s) + rand(s) + rand(s) + rand(s) - 2) * 1.2247;
}
/** Poisson draw for small lambda. */
export function poisson(s: GameState, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= rand(s);
  } while (p > L && k < 50);
  return k - 1;
}

export const newId = (s: GameState) => ++s.nextId;
export const now = (s: GameState) => s.day * 1440 + s.minute;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ---- event outbox (drained by the UI each frame)
export const outbox: SimEvent[] = [];
export function emit(e: SimEvent) {
  outbox.push(e);
  if (outbox.length > 400) outbox.splice(0, outbox.length - 400);
}
export function news(s: GameState, text: string, tone: NewsItem['tone'] = 'info', toast = true) {
  s.news.unshift({ day: s.day, minute: s.minute, text, tone });
  if (s.news.length > 60) s.news.length = 60;
  if (toast) emit({ type: 'toast', text, tone });
}

// ---- formatting
export function money(n: number, cents = false): string {
  const neg = n < 0;
  const v = Math.abs(n);
  const str = cents || (v < 100 && v % 1 !== 0) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('en-US');
  return (neg ? '-$' : '$') + str;
}
export function compactMoney(n: number): string {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e4) return `${sign}$${(v / 1e3).toFixed(1)}k`;
  return money(n);
}
export function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
}
export function plural(n: number, w: string, p = w + 's') {
  return `${n} ${n === 1 ? w : p}`;
}

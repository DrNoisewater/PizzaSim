// Inspector Logan: a rare, unannounced health & operations inspector. He walks the store for
// about an hour (kitchen, walk-in, tables, the line, the pass), then hands over a report card:
// two grades, a score, pointers, and a reward or a consequence.
import { teamBoost } from './manager';
import { addBuzz } from './fun';
import type { GameState, Store } from './types';
import { DIFFICULTY, loc, storageCap, storageUsed } from './state';
import { clamp, money, news, now } from './util';

export const INSPECTOR_NAME = 'Inspector Logan';
const VISIT_MIN = 60;

export function letter(score: number) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

/** Report tiers, best first. */
export const LOGAN_TIERS = {
  gold: 'Outstanding',
  good: 'Good',
  pass: 'Passed',
  minor: 'Needs work',
  serious: 'Failed',
  critical: 'Failed badly',
} as const;
export type LoganTier = keyof typeof LOGAN_TIERS;

export function startInspection(s: GameState, st: Store) {
  const t = st.today;
  st.inspector = {
    until: now(s) + VISIT_MIN,
    base: { served: t.served, walkouts: t.walkouts, turnedAway: t.turnedAway, refunds: t.refunds, soldOut: t.soldOut, drops: t.drops, lineWaitSum: t.lineWaitSum, lineWaitN: t.lineWaitN, serviceSum: t.serviceSum, serviceN: t.serviceN },
    cleanSum: 0,
    dirtySum: 0,
    moraleSum: 0,
    samples: 0,
    coldSum: 0,
    energySum: 0,
    lineSum: 0,
    overfull: false,
  };
  s.loganLast = s.day;
  s.notice = {
    kind: 'loganArrive',
    storeId: st.id,
    title: `${INSPECTOR_NAME} just walked in`,
    body: `The city's health & operations inspector is at ${loc(st).name}, clipboard out. For the next hour he'll poke around the kitchen and the walk-in, check the tables and floors, time the line, watch the pass, and see how your team is holding up. Then you get a report card. Ace it and word gets around; flunk it and your reputation takes a knock for a few days.`,
  };
  news(s, `${INSPECTOR_NAME} is inspecting ${loc(st).name}.`, 'info', false);
}

/** Called every sim step while he's on site. */
export function watchInspection(s: GameState, st: Store, dt: number) {
  const w = st.inspector;
  if (!w) return;
  w.samples += dt;
  w.cleanSum += st.cleanliness * dt;
  w.dirtySum += new Set(st.dirty.map((x) => Math.floor(x / 2))).size * dt;
  const on = st.staff.filter((x) => x.onFloor);
  w.moraleSum += (on.length ? on.reduce((a, x) => a + x.morale, 0) / on.length : 50) * dt;
  w.energySum = (w.energySum ?? 0) + (on.length ? on.reduce((a, x) => a + x.energy, 0) / on.length : 70) * dt;
  const t = now(s);
  const cold = st.orders.filter((o) => o.state === 'ready' && o.kind === 'dine' && o.readyAt !== undefined && t - o.readyAt > 4).length;
  w.coldSum = (w.coldSum ?? 0) + cold * dt;
  w.lineSum = (w.lineSum ?? 0) + st.customers.filter((c) => c.state === 'queue').length * dt;
  if (storageUsed(st, false) > storageCap(st) + 1) w.overfull = true;
  if (t >= w.until) finishInspection(s, st);
}

export function finishInspection(s: GameState, st: Store) {
  const w = st.inspector;
  if (!w) return;
  st.inspector = null;
  const t = st.today, b = w.base;
  const n = Math.max(0.25, w.samples);
  const clean = w.cleanSum / n, dirty = w.dirtySum / n, morale = w.moraleSum / n;
  const energy = (w.energySum ?? 70 * n) / n, cold = (w.coldSum ?? 0) / n, line = (w.lineSum ?? 0) / n;
  const d = (k: keyof typeof b) => (t[k] as number) - b[k];
  const lineWait = d('lineWaitN') ? d('lineWaitSum') / d('lineWaitN') : 0;
  const service = d('serviceN') ? d('serviceSum') / d('serviceN') : 0;
  const lost = d('walkouts') + d('turnedAway');
  const tips: { v: number; tip: string }[] = [];

  // ---- health: floors, tables, food on the floor, the walk-in
  let health = 100;
  const hp = (v: number, tip: string) => {
    if (v <= 0.5) return;
    health -= v;
    tips.push({ v, tip });
  };
  hp(Math.max(0, 84 - clean) * 1.3, `Floors and counters averaged ${Math.round(clean)}% clean. I want 85+. More front-of-house hours, or better cleaning gear.`);
  hp(dirty * 9, `Dirty tables sat uncleared (about ${dirty.toFixed(1)} at a time). Bus tables between orders; a dishwasher speeds it up.`);
  hp(d('drops') * 5, `${d('drops')} pizza${d('drops') === 1 ? '' : 's'} had to be remade while I watched. Training cuts down on mistakes.`);
  hp(w.overfull ? 12 : 0, 'The walk-in was crammed past capacity. Order to fit, or upgrade storage.');
  hp(cold * 6, 'Food sat on the pass going cold. Someone needs to be running plates.');
  health = clamp(health, 0, 100);

  // ---- operations: the line, speed, losses, the team
  let ops = 100;
  const pen = (v: number, tip: string) => {
    if (v <= 0.5) return;
    ops -= v;
    tips.push({ v, tip });
  };
  pen(Math.min(22, Math.max(0, lineWait - 3) * 4), `People waited ${lineWait.toFixed(1)} minutes in line before ordering. Another person on the till, or faster registers.`);
  pen(Math.min(12, Math.max(0, line - 4) * 2.5), `The line averaged ${line.toFixed(0)} people. Check the Staff coverage strip for your rush hours.`);
  pen(Math.min(22, Math.max(0, service - 18) * 2), `Orders took ${service.toFixed(0)} minutes from till to table. Look at kitchen and oven capacity in the day plan.`);
  pen(Math.min(22, lost * 3), `${lost} customer${lost === 1 ? '' : 's'} gave up or walked past the line.`);
  pen(Math.min(20, d('refunds') * 6), `${d('refunds')} refund${d('refunds') === 1 ? '' : 's'} for food that never came.`);
  pen(Math.min(15, d('soldOut') * 4), 'You ran out of ingredients mid-service. Order the forecast plus a buffer every morning.');
  pen(Math.max(0, 55 - morale) * 0.7, `The team looked miserable (morale ${Math.round(morale)}). Check pay against market and workload.`);
  pen(Math.max(0, 40 - energy) * 0.5, `Your staff were running on fumes (energy ${Math.round(energy)}). Shorter shifts or a breakroom.`);
  if (!st.staff.some((x) => x.role === 'front' && x.onFloor)) pen(12, 'Nobody was working front of house; the kitchen was doing everything.');
  ops = clamp(ops, 0, 100);

  const score = Math.round(health * 0.5 + ops * 0.5);
  const low = Math.min(health, ops);
  // both grades have to be good for a reward; the overall score decides how bad a failure is
  const tier: LoganTier =
    score >= 88 && low >= 80 ? 'gold'
    : score >= 78 && low >= 68 ? 'good'
    : score >= 64 && low >= 50 ? 'pass'
    : score >= 50 ? 'minor'
    : score >= 36 ? 'serious'
    : 'critical';
  const bad = DIFFICULTY[s.difficulty].badEvents;
  const dip = (mult: number, days: number) => (s.pendingEffects ??= []).push({ kind: 'traffic', storeId: st.id, mult, daysLeft: days, label: `${INSPECTOR_NAME}'s ${mult < 1 ? 'bad' : 'glowing'} report` });
  let effect = '';
  let fine = 0;
  switch (tier) {
    case 'gold':
      st.rating = clamp(st.rating + 0.15, 1, 5);
      dip(1.12, 3);
      teamBoost(s, st, 3, 1.05, 6, `Aced ${INSPECTOR_NAME}'s inspection`);
      addBuzz(s, st, 8, 'Aced the inspection');
      effect = 'Outstanding! Rating up, and +12% customers for 3 days as word gets around, starting tomorrow. The crew is proud: +6 morale and 5% faster for 3 days.';
      break;
    case 'good':
      st.rating = clamp(st.rating + 0.05, 1, 5);
      dip(1.05, 2);
      teamBoost(s, st, 2, 1.03, 3, `Good report from ${INSPECTOR_NAME}`);
      addBuzz(s, st, 3, 'Good inspection');
      effect = 'A good report: small rating bump and +5% customers for 2 days, starting tomorrow. The crew gets a lift: +3 morale and a little faster for 2 days.';
      break;
    case 'pass':
      effect = 'You passed. No reward this time. Fix the pointers and aim higher next visit.';
      break;
    case 'minor':
      st.rating = clamp(st.rating - 0.05, 1, 5);
      dip(0.95, 2);
      effect = 'Needs work: your reputation dips (-5% customers for 2 days, starting tomorrow). No fine this time.';
      break;
    case 'serious':
      fine = Math.round(Math.min(120, 40 + 5 * s.level) * bad);
      st.rating = clamp(st.rating - 0.1, 1, 5);
      dip(0.9, 3);
      effect = `Failed: ${money(fine)} fine, rating down, and -10% customers for 3 days, starting tomorrow.`;
      break;
    case 'critical':
      fine = Math.round(Math.min(220, 70 + 9 * s.level) * bad);
      st.rating = clamp(st.rating - 0.15, 1, 5);
      dip(0.85, 4);
      effect = `Failed badly: ${money(fine)} fine, rating down, and -15% customers for 4 days, starting tomorrow.`;
      break;
  }
  if (fine) {
    s.cash -= fine;
    st.today.other += fine;
  }
  tips.sort((a, b2) => b2.v - a.v);
  const good = tier === 'gold' || tier === 'good';
  const pointers = tips.slice(0, tier === 'gold' ? 1 : 3).map((x) => (tier === 'gold' ? `Only nitpick: ${x.tip.charAt(0).toLowerCase()}${x.tip.slice(1)}` : x.tip));
  if (tier === 'gold') pointers.unshift('Honestly? Clean, quick and well run. This is what I like to see.');
  else if (tier === 'good') pointers.unshift('Solid work. A couple of things between you and an A.');
  else if (tier === 'pass') pointers.unshift('You scraped by. Here\'s what I\'d fix first.');
  else pointers.push("I'll be back. Fix these and the next report will look a lot better.");
  if (!pointers.length) pointers.push('Nothing to report. Keep it up.');
  st.lastInspection = { day: s.day, score, health: Math.round(health), ops: Math.round(ops) };
  s.notice = {
    kind: 'loganReport',
    storeId: st.id,
    title: `${INSPECTOR_NAME}'s report card`,
    body: `${loc(st).name}, day ${s.day}.`,
    health: Math.round(health),
    ops: Math.round(ops),
    score,
    tips: pointers,
    effect,
    pass: tier !== 'minor' && tier !== 'serious' && tier !== 'critical',
    tier: LOGAN_TIERS[tier],
  };
  news(s, `${INSPECTOR_NAME} graded ${loc(st).name}: health ${letter(health)}, operations ${letter(ops)} (${score}/100, ${LOGAN_TIERS[tier].toLowerCase()}).`, good ? 'good' : tier === 'pass' ? 'info' : 'bad', false);
}

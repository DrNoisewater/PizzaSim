// Headless balance test: a simple bot plays N days and prints a summary per day.
// Run: npx tsx scripts/sim-test.ts [days] [seed] [difficulty] [quiet]
import { createGame, loc, up, dailyWages, stockOf } from '../src/core/state';
import { advance } from '../src/core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../src/core/day';
import * as A from '../src/core/actions';
import { ITEM, MENU } from '../src/data/catalog';
import { UPGRADES } from '../src/data/upgrades';
import { LOCATIONS, type Role } from '../src/data/world';
import { outbox } from '../src/core/util';
import { suggestOrder, fitToBudget, neededIngredients } from '../src/core/inventory';
import { daySummary } from '../src/core/forecast';
import type { GameState, Store } from '../src/core/types';

const DAYS = Number(process.argv[2] ?? 30);
const SEED = Number(process.argv[3] ?? 7);
const DIFF = (process.argv[4] ?? 'standard') as 'relaxed' | 'standard' | 'hard';
const QUIET = process.argv[5] === 'q';
const s: GameState = createGame('Bot Pizza', DIFF, SEED);

function hireRole(st: Store, role: Role) {
  const c = st.candidates.filter((q) => q.role === role).sort((a, b) => b.skill - a.skill)[0];
  if (c) return A.hire(s, st, c.id).ok;
  return false;
}

function botPrep() {
  // the bot manages shifts day to day itself, so it stays off the weekly schedule
  for (const st of s.stores) st.weekly = false;
  for (const st of s.stores) {
    const count = (r: Role) => st.staff.filter((x) => x.role === r).length;
    const y = st.history[st.history.length - 1];
    const plan = daySummary(s, st, 'today');
    const reserve = 900 + dailyWages(st) * 1.5;
    if (count('front') < 1) hireRole(st, 'front');
    if (count('cook') < 1) hireRole(st, 'cook');
    if (y && s.cash > reserve) {
      const missed = (y.turnedAway + y.walkouts + y.refunds) / Math.max(1, y.served + y.turnedAway + y.walkouts);
      if (missed > 0.12) {
        if (plan.limit === 'kitchen' && count('cook') < (up(st, 'prep').stations ?? 1)) hireRole(st, 'cook');
        else if ((plan.limit === 'front' || plan.limit === 'tills') && count('front') < 4) hireRole(st, 'front');
      }
    }
    if (st.upgrades.delivery > 0 && count('driver') < 1) hireRole(st, 'driver');
    if (s.level >= 5 && count('manager') < 1 && s.cash > 4000) hireRole(st, 'manager');
    // stock first, like a careful player would
    const lines = fitToBudget(s, st, suggestOrder(s, st), Math.max(0, s.cash - 50));
    const r = A.orderSupplies(s, st, lines, false);
    if (!r.ok && Object.keys(lines).length && !QUIET) console.log('  order failed:', r.msg);
    // keep everyone reasonably happy
    for (const x of st.staff) if (x.morale < 30 && s.cash > 300) A.giveBonus(s, st, x.id);
    // upgrades: fix the bottleneck first, then the rest, keeping a reserve
    const prio: string[] = [];
    if (plan.limit === 'oven') prio.push('oven');
    if (plan.limit === 'kitchen') prio.push('prep');
    if (plan.limit === 'tills') prio.push('register');
    prio.push('storage', 'prep', 'oven', 'register', 'dining', 'delivery', 'sign', 'decor', 'cleaning', 'online', 'breakroom', 'software');
    const saving = s.level >= 4 && s.stores.length < 2 && s.cash < 22000;
    // the bottleneck always gets fixed; everything else waits while saving for a new store
    const urgent = prio.slice(0, prio.length - 12);
    for (const id of saving ? urgent : prio) {
      const cost = A.upgradeCost(s, st, id as never);
      if (cost !== null && s.cash > cost + reserve + 1000) A.buyUpgrade(s, st, id as never);
    }

    if (s.level >= 2 && s.cash > 1500 && !st.campaigns.length) A.runCampaign(s, st, 'flyers');
    // top-up truck after upgrades and hires, like the game offers before opening
    const more = fitToBudget(s, st, suggestOrder(s, st), Math.max(0, s.cash - 50));
    if (Object.keys(more).length) A.orderSupplies(s, st, more, false);
  }
  for (const m of MENU) if (!s.unlocked.includes(m.id) && s.level >= m.unlockLevel && s.cash > m.unlockCost + 3000) A.unlockRecipe(s, m.id);
  for (const L of LOCATIONS) if (!s.stores.some((x) => x.locationId === L.id) && s.level >= L.reqLevel && s.cash > L.cost + 6000) A.buyLocation(s, L.id);
  if (s.choice) resolveChoice(s, s.choice.options[0].id);
}

const t0 = Date.now();
let profitSum = 0;
const cleanSum = new Map<number, number>(), cleanN = new Map<number, number>();
for (let d = 0; d < DAYS && !s.gameOver; d++) {
  cleanSum.clear(); cleanN.clear();
  botPrep();
  const o = openForBusiness(s);
  if (!o.ok) console.log('open failed', o.msg);
  let guard = 0;
  while ((s.phase === 'open' || s.phase === 'closing') && guard++ < 20000) {
    advance(s, 2);
    if (s.phase === 'open') for (const st of s.stores) { cleanSum.set(st.id, (cleanSum.get(st.id) ?? 0) + st.cleanliness); cleanN.set(st.id, (cleanN.get(st.id) ?? 0) + 1); }
    if (s.choice) resolveChoice(s, s.choice.options[0].id);
    if (s.notice) {
      if (s.notice.kind === 'loganReport' && !QUIET) console.log(`    LOGAN d${s.day}: health ${s.notice.health} ops ${s.notice.ops} score ${s.notice.score} ${s.notice.tier} | ${s.notice.effect}`);
      if (s.notice.kind === 'criticReport' && !QUIET) console.log(`    CRITIC d${s.day}: ${s.notice.score} ${s.notice.tier} ${JSON.stringify(s.notice.scores)} | ${s.notice.effect}`);
      s.notice = null;
    }
  }
  const rep = s.report!;
  if (process.env.WHY) for (const st of s.stores) {
    const x = st.today;
    if (x.soldOut > 10) {
      const empty = neededIngredients(s, st).filter((k) => stockOf(st, k) < 1);
      console.log(`  D${s.day} soldOut ${x.soldOut}: pred ${Math.round(x.fcPred ?? 0)} fx ${s.effects.map((e) => e.label + ':' + e.mult).join(';')} camp ${st.campaigns.map((c) => c.id).join(',')} cash ${Math.round(s.dayStartCash)} empty ${empty.join(',')} | storage ${st.upgrades.storage} sw ${st.upgrades.software} buf ${st.orderBuffer} | used ${JSON.stringify(x.used)}`);
    }
  }
  let dayProfit = 0;
  const parts = rep.stores.map((r) => {
    const st = s.stores.find((x) => x.id === r.storeId)!;
    const x = r.stats;
    const sat = x.satCount ? x.satSum / x.satCount : 0;
    const costs = x.supplies + x.wages + x.rent + x.marketing + x.other + x.loan;
    dayProfit += x.revenue - costs;
    const roles = ['cook', 'front', 'driver', 'manager'].map((k) => st.staff.filter((q) => q.role === k).length).join('/');
    return `${loc(st).name.slice(0, 6)} rev ${x.revenue.toFixed(0).padStart(5)} pr ${(x.revenue - costs).toFixed(0).padStart(5)} srv ${String(x.served).padStart(3)} away ${String(x.turnedAway).padStart(3)} walk ${String(x.walkouts).padStart(2)} ref ${String(x.refunds).padStart(2)} sold ${String(x.soldOut).padStart(2)} drop ${x.drops}[${x.remakes?.drop ?? 0}/${x.remakes?.wrong ?? 0}/${x.remakes?.burnt ?? 0}] line ${(x.lineWaitN ? x.lineWaitSum / x.lineWaitN : 0).toFixed(1)}m svc ${(x.serviceN ? x.serviceSum / x.serviceN : 0).toFixed(0)}m sat ${sat.toFixed(0)} ★${st.rating.toFixed(2)} crew ${roles} waste $${x.waste.toFixed(0)} cl ${((cleanSum.get(st.id) ?? 0) / Math.max(1, cleanN.get(st.id) ?? 0)).toFixed(0)}`;
  });
  profitSum += dayProfit;
  if (!QUIET) console.log(`D${String(rep.day).padStart(2)} L${s.level} $${s.cash.toFixed(0).padStart(7)} | ${parts.join(' || ')}`);
  if (!QUIET && rep.advice?.length) console.log('    ' + rep.advice.join(' | '));
  outbox.length = 0;
  beginNextDay(s);
}
console.log(`${DIFF} seed ${SEED}: ${Date.now() - t0}ms. day ${s.day} level ${s.level}, cash $${s.cash.toFixed(0)}, avg profit/day $${(profitSum / Math.max(1, s.stats.daysCompleted)).toFixed(0)}, stores ${s.stores.length}, goals ${s.goalsDone.length}, served ${s.stats.served}, lost ${s.stats.lost}${s.gameOver ? ' GAME OVER' : ''}`);
if (!QUIET) {
  console.log('Upgrades:', s.stores.map((st) => UPGRADES.map((u) => `${u.id}${st.upgrades[u.id]}`).join(' ')).join(' | '));
  console.log('Unlocked:', s.unlocked.map((i) => ITEM[i].name).join(', '));
}

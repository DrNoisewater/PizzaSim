// Player level, unlocks and the goal chain.
import { MENU } from '../data/catalog';
import { UPGRADES } from '../data/upgrades';
import { CAMPAIGNS, LOCATIONS, ROLES, LOANS, LOYALTY } from '../data/world';
import type { GameState } from './types';
import { emit, news } from './util';

export function xpForLevel(level: number) {
  if (level <= 1) return 0;
  return Math.round(250 * Math.pow(level - 1, 1.5));
}

export function addXp(s: GameState, amount: number) {
  s.xp += amount;
  while (s.xp >= xpForLevel(s.level + 1)) {
    s.level++;
    const unlocks = unlocksAt(s.level);
    emit({ type: 'levelup', text: `Level ${s.level}!`, tone: 'good' });
    news(s, `Reached level ${s.level}${unlocks.length ? ': unlocked ' + unlocks.slice(0, 4).join(', ') + (unlocks.length > 4 ? '…' : '') : ''}.`, 'good', false);
  }
}

export function unlocksAt(level: number): string[] {
  const out: string[] = [];
  for (const m of MENU) if (m.unlockLevel === level && m.unlockCost > 0) out.push(`${m.name} recipe`);
  for (const u of UPGRADES) u.levels.forEach((l, i) => {
    if (i > 0 && l.req === level && level > 1) out.push(l.name);
  });
  for (const c of CAMPAIGNS) if (c.req === level && level > 1) out.push(c.name);
  for (const l of LOCATIONS) if (l.reqLevel === level && l.cost > 0) out.push(`${l.name} location`);
  for (const r of Object.values(ROLES)) if (r.req === level && level > 1) out.push(`${r.name} hires`);
  for (const l of LOANS) if (l.req === level && level > 1) out.push(`$${l.amount.toLocaleString()} loan`);
  if (LOYALTY.req === level) out.push('Loyalty program');
  return out;
}

export interface GoalDef {
  id: string;
  title: string;
  hint: string;
  reward: number;
  progress: (s: GameState) => { cur: number; target: number };
}

const totalStaff = (s: GameState) => s.stores.reduce((n, st) => n + st.staff.length, 0);
const bestRating = (s: GameState) => Math.max(...s.stores.map((st) => st.rating));
const has = (s: GameState, f: (st: GameState['stores'][number]) => boolean) => (s.stores.some(f) ? 1 : 0);

export const GOALS: GoalDef[] = [
  { id: 'hireCashier', title: 'Hire front-of-house staff', hint: 'Staff → Hire. Frees up your cook.', reward: 200, progress: (s) => ({ cur: has(s, (st) => st.staff.some((x) => x.role === 'front')), target: 1 }) },
  { id: 'restock', title: 'Order supplies', hint: 'Stock → Fill to forecast → Order.', reward: 100, progress: (s) => ({ cur: Math.min(1, s.stats.ordersPlaced), target: 1 }) },
  { id: 'firstDay', title: 'Run your first day', hint: 'Press Open for business.', reward: 150, progress: (s) => ({ cur: Math.min(1, s.stats.daysCompleted), target: 1 }) },
  { id: 'serve50', title: 'Serve 50 customers', hint: 'Keep the line moving.', reward: 250, progress: (s) => ({ cur: s.stats.served, target: 50 }) },
  { id: 'upgrade1', title: 'Buy an upgrade', hint: 'Upgrades → oven or prep line.', reward: 200, progress: (s) => ({ cur: Math.min(1, s.stats.upgradesBought), target: 1 }) },
  { id: 'level2', title: 'Reach level 2', hint: 'Happy customers earn XP.', reward: 250, progress: (s) => ({ cur: Math.min(s.level, 2), target: 2 }) },
  { id: 'recipe', title: 'Add a new recipe', hint: 'Menu → unlock a recipe.', reward: 300, progress: (s) => ({ cur: Math.min(1, s.stats.recipesUnlocked), target: 1 }) },
  { id: 'rev1k', title: 'Make $1,000 in sales in one day', hint: 'More staff, bigger oven, fair prices.', reward: 400, progress: (s) => ({ cur: Math.round(s.stats.bestDayRevenue), target: 1000 }) },
  { id: 'ad', title: 'Run a marketing campaign', hint: 'Marketing → Flyer Drop.', reward: 300, progress: (s) => ({ cur: Math.min(1, s.stats.campaignsRun), target: 1 }) },
  { id: 'rating35', title: 'Reach a 3.5★ rating', hint: 'Fast, tasty, clean.', reward: 500, progress: (s) => ({ cur: Math.round(bestRating(s) * 10) / 10, target: 3.5 }) },
  { id: 'delivery', title: 'Start delivering', hint: 'Upgrades → Delivery, then hire a driver.', reward: 500, progress: (s) => ({ cur: Math.min(1, s.stats.deliveries), target: 1 }) },
  { id: 'train', title: 'Train a staff member', hint: 'Staff → Train. +1 skill tomorrow.', reward: 300, progress: (s) => ({ cur: Math.min(1, s.stats.trained), target: 1 }) },
  { id: 'serve500', title: 'Serve 500 customers', hint: 'Grow to match demand.', reward: 800, progress: (s) => ({ cur: s.stats.served, target: 500 }) },
  { id: 'oven2', title: 'Install a Double Deck Oven', hint: 'Upgrades → Oven.', reward: 600, progress: (s) => ({ cur: has(s, (st) => st.upgrades.oven >= 1), target: 1 }) },
  { id: 'rating4', title: 'Reach a 4★ rating', hint: 'Skilled cooks, good ingredients.', reward: 1000, progress: (s) => ({ cur: Math.round(bestRating(s) * 10) / 10, target: 4 }) },
  { id: 'store2', title: 'Open a second location', hint: 'Empire → Campus Corner (level 3).', reward: 2500, progress: (s) => ({ cur: s.stores.length, target: 2 }) },
  { id: 'staff10', title: 'Employ 10 people', hint: 'Across all stores.', reward: 1500, progress: (s) => ({ cur: totalStaff(s), target: 10 }) },
  { id: 'profit3k', title: 'Make $3,000 profit in one day', hint: 'After wages, rent and supplies.', reward: 2000, progress: (s) => ({ cur: Math.round(s.stats.bestDayProfit), target: 3000 }) },
  { id: 'level10', title: 'Reach level 10', hint: 'Keep growing.', reward: 5000, progress: (s) => ({ cur: s.level, target: 10 }) },
  { id: 'store4', title: 'Own 4 locations', hint: 'Downtown and Harbor earn big.', reward: 10000, progress: (s) => ({ cur: s.stores.length, target: 4 }) },
  { id: 'rating48', title: 'Reach 4.8★ at any store', hint: 'Excellence everywhere.', reward: 5000, progress: (s) => ({ cur: Math.round(bestRating(s) * 10) / 10, target: 4.8 }) },
  { id: 'mogul', title: 'Pizza Mogul: own all 5 locations', hint: 'Airport Terminal B is the final prize.', reward: 25000, progress: (s) => ({ cur: s.stores.length, target: 5 }) },
  { id: 'million', title: 'Earn $1,000,000 in lifetime sales', hint: 'The long game.', reward: 50000, progress: (s) => ({ cur: Math.round(s.stats.revenue), target: 1000000 }) },
];

/** The next few unfinished goals. */
export function activeGoals(s: GameState, n = 3) {
  return GOALS.filter((g) => !s.goalsDone.includes(g.id)).slice(0, n);
}

export function checkGoals(s: GameState) {
  for (const g of activeGoals(s, 3)) {
    const p = g.progress(s);
    if (p.cur >= p.target) {
      s.goalsDone.push(g.id);
      s.cash += g.reward;
      addXp(s, 40);
      emit({ type: 'goal', text: `Goal complete: ${g.title} (+$${g.reward.toLocaleString()})`, tone: 'good' });
      news(s, `Goal complete: ${g.title}. Reward $${g.reward.toLocaleString()}.`, 'good', false);
    }
  }
}

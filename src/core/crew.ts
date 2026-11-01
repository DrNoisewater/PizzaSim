// Celebrate the crew: after a good run of days, spend a little to say thanks. Small price, big
// morale. Offered on the receipt at most once a week.
import type { GameState, Store, Staff } from './types';
import { clamp, money } from './util';
import { teamBoost } from './manager';

export type CelebrationId = 'lunch' | 'shoutout' | 'giftcards' | 'bowling' | 'karts';
export const CELEBRATIONS: Record<CelebrationId, { name: string; perHead: number; morale: number; boost?: [number, number]; desc: string; done: string }> = {
  shoutout: { name: 'Shout-outs and an early clock-out', perHead: 0, morale: 2, desc: 'Names on the board, everyone home 15 minutes early. Free, and it still counts.', done: 'Names went up on the board and everybody left a little early. Small thing, real smiles.' },
  lunch: { name: 'Order lunch in for the crew', perHead: 9, morale: 5, desc: 'Tacos, subs, whatever they vote for. Anything but pizza.', done: 'Lunch showed up and the break room went quiet in the best way.' },
  giftcards: { name: 'Coffee gift cards', perHead: 12, morale: 5, boost: [1, 1.03], desc: 'A thank-you card and caffeine for tomorrow\'s rush.', done: 'Coffee cards handed out. Tomorrow\'s crew is caffeinated and grateful.' },
  bowling: { name: 'Team bowling night', perHead: 18, morale: 8, boost: [2, 1.04], desc: 'Shoes, lanes, terrible nicknames on the scoreboard.', done: 'Bowling night was a hit. Someone named "Extra Cheese" bowled a 180.' },
  karts: { name: 'Go-kart racing', perHead: 26, morale: 10, boost: [3, 1.05], desc: 'Bragging rights for a week. The kitchen versus the front.', done: 'Go-karts! The kitchen won, and nobody is allowed to forget it.' },
};

/** Who gets invited: everyone who worked in the last few days. */
function invited(s: GameState, st: Store): Staff[] {
  return st.staff.filter((x) => x.record?.some((r) => r.day >= s.day - 3) || x.role === 'manager');
}

/** A good run: the last three days all made money, customers were happy, and few walked out. */
export function celebrationDue(s: GameState, st: Store): boolean {
  if (s.phase !== 'report' || s.gameOver) return false;
  const c = st.celebrate;
  if (c && (c.offerDay === s.day || s.day - c.lastDay < 7)) return c.offerDay === s.day && !c.doneDay;
  const h = st.history.slice(-3);
  if (h.length < 3 || s.day < 5) return false;
  const good = h.every((d) => {
    const profit = d.revenue - (d.supplies + d.wages + d.rent + d.marketing + d.other + d.loan);
    const sat = d.satCount ? d.satSum / d.satCount : 0;
    const lost = d.walkouts + d.turnedAway + d.refunds;
    return profit > 0 && sat >= 62 && lost <= Math.max(6, d.served * 0.12);
  });
  if (!good || invited(s, st).length < 2) return false;
  st.celebrate = { offerDay: s.day, lastDay: c?.lastDay ?? -99 };
  return true;
}

export function celebrationCost(s: GameState, st: Store, id: CelebrationId) {
  return CELEBRATIONS[id].perHead * invited(s, st).length;
}

export function celebrate(s: GameState, st: Store, id: CelebrationId): { ok: boolean; msg: string } {
  const c = st.celebrate;
  if (!c || c.offerDay !== s.day || c.doneDay) return { ok: false, msg: 'No celebration lined up right now.' };
  const def = CELEBRATIONS[id];
  const crew = invited(s, st);
  const cost = def.perHead * crew.length;
  if (s.cash < cost) return { ok: false, msg: `That costs ${money(cost)}.` };
  s.cash -= cost;
  st.today.other += cost;
  for (const x of crew) {
    x.morale = clamp(x.morale + def.morale, 0, 100);
    x.moraleWhy = [{ label: def.name, v: def.morale }, ...x.moraleWhy].slice(0, 6);
  }
  if (def.boost) teamBoost(s, st, def.boost[0], def.boost[1], 0, def.name);
  c.doneDay = s.day;
  c.lastDay = s.day;
  c.result = `${def.done} (+${def.morale} morale${def.boost ? `, a little faster for ${def.boost[0]} day${def.boost[0] > 1 ? 's' : ''}` : ''}${cost ? `, ${money(cost)}` : ''})`;
  return { ok: true, msg: c.result };
}

/** Skip it this time (it'll come up again after another good run). */
export function skipCelebration(s: GameState, st: Store) {
  if (st.celebrate?.offerDay === s.day) {
    st.celebrate.doneDay = s.day;
    st.celebrate.result = 'Maybe next time.';
  }
}

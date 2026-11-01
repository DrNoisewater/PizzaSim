// The food critic: rarer than Inspector Logan. Orders like a customer, sits down, and judges
// the food (your cooks, oven and supplier), the wait, the freshness of what went on the pizza
// (anything on its last day?) and the room. Light and fun, with a real reward or sting.
import { teamBoost } from './manager';
import { addBuzz } from './fun';
import type { GameState, Order, Store } from './types';
import { CRITIC_NAME, CRITIC_PAPER } from '../data/meta';
import { SUPPLIERS } from '../data/catalog';
import { loc, up } from './state';
import { clamp, news, now, pickOne } from './util';
import type { SatResult } from './economy';

export function criticArrives(s: GameState, st: Store) {
  s.criticLast = s.day;
  s.notice = {
    kind: 'criticArrive',
    storeId: st.id,
    title: `${CRITIC_NAME} has taken a table`,
    body: `The most feared pen at ${CRITIC_PAPER} just walked into ${loc(st).name}. He'll order, sit, and judge everything: how the food tastes, how long it takes, whether anything on the plate is past its prime, and whether the room is fit to eat in. No pressure.`,
  };
  news(s, `${CRITIC_NAME} is dining at ${loc(st).name}. Look sharp!`, 'info', false);
}

const LINES = {
  rave: [
    'I came expecting to be disappointed. I left wanting a second slice. Do not tell anyone I said that.',
    'The crust crackled, the sauce sang, and for eleven minutes I forgot to be cross. Remarkable.',
    'A pizza with something to say, and the manners to say it quickly. I approve. Reluctantly.',
  ],
  pass: [
    'Competent. Pleasant, even. I may return when nobody is looking.',
    'Respectable work. Not a revelation, but I have eaten far worse in far nicer rooms.',
    'A sound little pizzeria. Room to grow, and I suspect they will.',
  ],
  meh: [
    'It was a pizza. It arrived. I ate it. That is the most I can say.',
    'Neither crime nor triumph. I have already begun to forget it.',
    'Fine. A word I use sparingly, and never as a compliment.',
  ],
  pan: [
    'I have had warmer welcomes from a parking ticket.',
    'The pizza was a rumor, the service a myth, and my patience a casualty.',
    'Somewhere in this kitchen is a good pizza. It did not visit my table.',
  ],
  walkout: ['I waited. And waited. I am still, in a sense, waiting. I will not be returning.'],
  refund: ['They took my order with great confidence and then, it seems, forgot I existed.'],
};

/**
 * The verdict, shown as a pop-up with his face. outcome: served (with the order and its
 * satisfaction result), or walkout / refund (an automatic pan).
 */
export function criticVerdict(s: GameState, st: Store, outcome: 'served' | 'walkout' | 'refund', o?: Order, r?: SatResult, arrived?: number) {
  let food = 0, speed = 0, fresh = 100, room = 0, overall = 0;
  const total = arrived !== undefined ? now(s) - arrived : 0;
  const notes: string[] = [];
  if (outcome === 'served' && o && r) {
    food = clamp((r.quality - 45) * 1.6 + 40, 0, 100);
    speed = clamp(100 - Math.max(0, total - 14) * 4.5, 0, 100);
    const stale = o.items.some((it) => it.stale);
    fresh = stale ? 65 : 100;
    const sup = SUPPLIERS[st.supplier].quality;
    if (sup < 0) fresh = Math.min(fresh, 85);
    room = clamp(st.cleanliness - new Set(st.dirty.map((x) => Math.floor(x / 2))).size * 8 + (up(st, 'decor').ambience ?? 0) * 4, 0, 100);
    overall = Math.round(food * 0.45 + speed * 0.25 + fresh * 0.15 + room * 0.15);
    if (food >= 80) notes.push('The food itself was genuinely good.');
    else if (food < 55) notes.push(sup < 0 ? 'The ingredients tasted cheap. A better supplier would show.' : 'Underwhelming pizza. Skilled cooks and a better oven make the difference.');
    if (speed < 60) notes.push(`${Math.round(total)} minutes from the door to the plate. Far too long.`);
    else if (speed >= 90) notes.push('Swift service. Appreciated.');
    if (stale) notes.push('Something on that pizza was on its last day. He noticed, of course. He always knows.');
    if (room < 60) notes.push('He did not enjoy the state of the dining room.');
  } else {
    overall = outcome === 'walkout' ? 15 : 20;
    notes.push(outcome === 'walkout' ? 'He gave up in the line before he could even order.' : 'His food never came. He was refunded, which did not help.');
  }
  const tier = outcome !== 'served' ? 'pan' : overall >= 80 ? 'rave' : overall >= 64 ? 'pass' : overall >= 48 ? 'meh' : 'pan';
  const quote = pickOne(s, outcome === 'walkout' ? LINES.walkout : outcome === 'refund' ? LINES.refund : LINES[tier]);
  let effect = '';
  const fx = (mult: number, days: number) => (s.pendingEffects ??= []).push({ kind: 'traffic', storeId: st.id, mult, daysLeft: days, label: `${CRITIC_NAME}'s ${mult > 1 ? 'rave' : 'pan'}` });
  if (tier === 'rave') {
    st.rating = clamp(st.rating + 0.25, 1, 5);
    fx(1.2, 4);
    teamBoost(s, st, 4, 1.05, 8, `${CRITIC_NAME} raved about us`);
    addBuzz(s, st, 15, 'The critic raved');
    effect = 'A rave review! Rating up, and +20% customers for 4 days, starting tomorrow. The crew is buzzing: +8 morale and 5% faster for 4 days.';
  } else if (tier === 'pass') {
    st.rating = clamp(st.rating + 0.08, 1, 5);
    fx(1.08, 2);
    teamBoost(s, st, 2, 1.03, 3, `Kind words from ${CRITIC_NAME}`);
    addBuzz(s, st, 5, 'Kind words from the critic');
    effect = 'A kind write-up: small rating bump and +8% customers for 2 days, starting tomorrow. The crew gets a lift: +3 morale and a little faster for 2 days.';
  } else if (tier === 'meh') effect = 'A shrug of a review. No harm done, no help either.';
  else {
    st.rating = clamp(st.rating - 0.2, 1, 5);
    fx(0.88, 3);
    effect = 'A pan. Rating down, and -12% customers for 3 days while people read it, starting tomorrow.';
  }
  st.reviews.unshift({ day: s.day, name: `${CRITIC_NAME}, ${CRITIC_PAPER}`, stars: tier === 'rave' ? 5 : tier === 'pass' ? 4 : tier === 'meh' ? 3 : 1.5, topic: outcome === 'served' ? r!.topic : outcome, text: quote, critic: true });
  if (st.reviews.length > 40) st.reviews.length = 40;
  s.notice = {
    kind: 'criticReport',
    storeId: st.id,
    title: tier === 'rave' ? `${CRITIC_NAME} loved it` : tier === 'pass' ? `${CRITIC_NAME} approves (mostly)` : tier === 'meh' ? `${CRITIC_NAME} is unmoved` : `${CRITIC_NAME} is not amused`,
    body: quote,
    score: overall,
    scores: outcome === 'served' ? [['Food', Math.round(food)], ['Wait', Math.round(speed)], ['Freshness', Math.round(fresh)], ['Dining room', Math.round(room)]] : [],
    tips: notes,
    effect,
    pass: tier === 'rave' || tier === 'pass',
    tier,
  };
  news(s, `${CRITIC_NAME} reviewed ${loc(st).name}: ${overall}/100.`, tier === 'rave' || tier === 'pass' ? 'good' : 'bad', false);
}

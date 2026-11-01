// Light-hearted surprises and the store's claim to fame.
//
// Fun visits: every 6 to 10 days someone memorable walks in during service and you decide how to
// handle it. Nothing here is a trap: the worst choice costs a little; the good ones earn Buzz.
//
// Buzz and the Wall of Fame: Buzz builds from great days, happy customers, a passed inspection or
// critic, and how you handle the fun visits. At each Buzz milestone the store gets noticed by a
// newsletter, a magazine, a TV show and so on: a few busy days, plus a small lasting bump in foot
// traffic and a spot on the Wall of Fame.
import type { GameState, Store, PendingChoice } from './types';
import { clamp, money, news, rand, randInt, pickOne } from './util';
import { loc } from './state';
import { addStock } from './inventory';

// ------------------------------------------------------------------ fun visits

interface FunOption {
  id: string;
  label: string;
  detail: string;
  /** What happens: return a short line for the toast. */
  run(s: GameState, st: Store): string;
}
interface FunEvent {
  id: string;
  title: string;
  body(s: GameState, st: Store): string;
  options: FunOption[];
  /** Only some stores or levels. */
  when?(s: GameState, st: Store): boolean;
}

const crewMorale = (st: Store, v: number, why: string) => {
  for (const x of st.staff) if (x.status === 'active' && !x.offToday) {
    x.morale = clamp(x.morale + v, 0, 100);
    x.moraleWhy = [{ label: why, v }, ...x.moraleWhy].slice(0, 6);
  }
};
const pay = (s: GameState, st: Store, v: number) => {
  s.cash -= v;
  st.today.other += v;
};
const earn = (s: GameState, st: Store, v: number) => {
  s.cash += v;
  st.today.revenue += v;
  s.stats.revenue += v;
};
const rate = (st: Store, v: number) => (st.rating = clamp(st.rating + v, 1, 5));
const traffic = (s: GameState, st: Store, mult: number, days: number, label: string) => s.effects.push({ kind: 'traffic', storeId: st.id, mult, daysLeft: days, label });

export const FUN_EVENTS: FunEvent[] = [
  {
    id: 'birthday',
    title: 'Surprise birthday party!',
    body: () => 'Twelve kids in party hats just walked in. Their parent asks if you can do something special for the birthday girl, who is turning seven and has opinions about cheese.',
    options: [
      { id: 'song', label: 'Whole crew sings Happy Birthday', detail: 'Free. The kids lose their minds.', run: (s, st) => { addBuzz(s, st, 3, 'Birthday sing-along'); crewMorale(st, 2, 'Sang for a birthday'); earn(s, st, 60); return 'The crew belted it out, the birthday girl beamed, and the parents ordered a stack of pizzas (+$60, +Buzz).'; } },
      { id: 'dessert', label: 'Free cinnamon knots for the table', detail: 'About $15. Parents remember this kind of thing.', run: (s, st) => { pay(s, st, 15); addBuzz(s, st, 4, 'Birthday treat'); rate(st, 0.03); return 'Free dessert for the party. Three parents asked for a catering menu (+Buzz, +rating).'; } },
      { id: 'normal', label: 'Treat it like any other order', detail: 'Fine. Just fine.', run: (s, st) => { earn(s, st, 45); return 'Pizzas served, cake was theirs. A perfectly normal party (+$45).'; } },
    ],
  },
  {
    id: 'quarters',
    title: 'Exact change, extremely exact',
    body: () => 'A customer wants to pay for two large pizzas entirely in quarters. He has them in a sock. The line is starting to build behind him.',
    options: [
      { id: 'count', label: 'Count them with a smile', detail: 'Slows the till for a few minutes.', run: (s, st) => { addBuzz(s, st, 2, 'Patience with the quarter guy'); crewMorale(st, 1, 'The quarter guy story'); return 'All 104 quarters counted. He left a quarter tip, and the crew has a new favorite story (+Buzz).'; } },
      { id: 'scale', label: 'Weigh the sock on the dough scale', detail: 'Fast, a little rude, very funny.', run: (s, st) => { addBuzz(s, st, 1, 'Sock math'); return 'The scale says $26 of quarters. Close enough. He was impressed, honestly.'; } },
    ],
  },
  {
    id: 'influencer',
    title: 'A food influencer wants a free pizza',
    body: () => 'Someone with a ring light and 40,000 followers offers a "collab": free pizza for a post. Their last video was of a hot dog eating contest.',
    options: [
      { id: 'yes', label: 'Sure, on the house', detail: 'About $14. Could be big, could be nothing.', run: (s, st) => { pay(s, st, 14); if (rand(s) < 0.6) { traffic(s, st, 1.15, 3, 'Influencer post going around'); addBuzz(s, st, 6, 'Influencer post'); return 'The post took off! Expect a few busier days (+15% customers for 3 days, +Buzz).'; } addBuzz(s, st, 1, 'Influencer post'); return 'The post got 31 likes, mostly bots. Nice pizza though.'; } },
      { id: 'discount', label: 'Offer 20% off instead', detail: 'A smaller gamble.', run: (s, st) => { earn(s, st, 11); if (rand(s) < 0.35) { traffic(s, st, 1.08, 2, 'A nice little shout-out online'); addBuzz(s, st, 3, 'Influencer shout-out'); return 'They paid, and still gave you a nice shout-out (+8% customers for 2 days).'; } return 'They paid and left. No post, but no harm.'; } },
      { id: 'no', label: 'Politely pass', detail: 'Nothing gained, nothing lost.', run: () => 'They found a taco truck instead.' },
    ],
  },
  {
    id: 'dog',
    title: 'A very good boy wanders in',
    body: () => 'A golden retriever with a fancy collar trots through the door and sits by the counter like he owns the place. His tag has a phone number.',
    options: [
      { id: 'call', label: 'Call the owner, give him water', detail: 'The decent thing.', run: (s, st) => { addBuzz(s, st, 4, 'Found a lost dog'); crewMorale(st, 3, 'Dog visit'); return 'His owner came running, cried a little, and posted about you everywhere (+Buzz, happy crew).'; } },
      { id: 'mascot', label: 'Let him greet customers until the owner arrives', detail: 'Best greeter you have ever had.', run: (s, st) => { addBuzz(s, st, 5, 'Guest greeter'); rate(st, 0.02); crewMorale(st, 2, 'Dog visit'); return 'Barkley greeted 40 people before his owner showed up. Customers were delighted (+Buzz, +rating).'; } },
    ],
  },
  {
    id: 'proposal',
    title: 'Someone is about to propose',
    body: () => 'A nervous customer asks if you can hide a ring under the pepperoni of a large pizza. Table four. Their partner is in the bathroom. Now or never.',
    options: [
      { id: 'yes', label: 'Absolutely. Crew, positions!', detail: 'High stakes, no pressure.', run: (s, st) => { if (rand(s) < 0.92) { addBuzz(s, st, 7, 'Pizza proposal'); crewMorale(st, 4, 'Helped with a proposal'); rate(st, 0.04); return 'She said YES! The whole store clapped. Someone filmed it (+Buzz, +rating).'; } addBuzz(s, st, 2, 'Pizza proposal'); return 'He asked, she laughed, she said "ask me again without marinara on it." Then she said yes.'; } },
      { id: 'card', label: 'Suggest the ring goes on the box instead', detail: 'Cleaner. Less romantic.', run: (s, st) => { addBuzz(s, st, 3, 'Pizza box proposal'); return 'Ring on the box, yes on the first try. Clean and sweet (+Buzz).'; } },
    ],
  },
  {
    id: 'team',
    title: 'The local team just won',
    body: () => 'A whole youth soccer team, still in cleats, piles in after winning their championship. The coach is waving a credit card and a trophy.',
    options: [
      { id: 'photo', label: 'Free soda and a photo for the wall', detail: 'About $20.', run: (s, st) => { pay(s, st, 20); earn(s, st, 140); addBuzz(s, st, 5, 'Champions on the wall'); return 'Big order, big cheers, and the team photo is going up by the register (+$140, +Buzz).'; } },
      { id: 'fast', label: 'Just get them fed fast', detail: 'Efficient. Hungry kids are loud.', run: (s, st) => { earn(s, st, 140); addBuzz(s, st, 1, 'Fed the champions'); return 'Twenty pizzas out in record time (+$140).'; } },
    ],
  },
  {
    id: 'grandma',
    title: 'Nonna has notes',
    body: () => 'An elderly woman tastes your sauce, closes her eyes, and says "close." She offers to show your cook her family secret: a pinch of something and a lot of patience.',
    options: [
      { id: 'learn', label: 'Take the lesson', detail: 'Your cooks might learn something.', run: (s, st) => { const cooks = st.staff.filter((x) => x.role === 'cook'); for (const c of cooks) c.xp += 120; crewMorale(st, 2, 'Nonna\'s sauce lesson'); addBuzz(s, st, 3, 'Nonna\'s seal of approval'); return `Nonna spent twenty minutes with the kitchen. ${cooks.length ? 'Your cooks picked up some experience' : 'Everyone picked up a trick'} and she left smiling (+Buzz).`; } },
      { id: 'thanks', label: 'Thank her with a free slice', detail: 'Respect your elders.', run: (s, st) => { pay(s, st, 4); addBuzz(s, st, 2, 'Kind to Nonna'); return 'She ate the slice, nodded once, and told her whole church group about you (+Buzz).'; } },
    ],
  },
  {
    id: 'pineapple',
    title: 'The great pineapple debate',
    body: () => 'Two customers in line start a very loud argument about pineapple on pizza. Other people are picking sides. Someone is recording.',
    options: [
      { id: 'vote', label: 'Hold a store-wide vote', detail: 'Democracy, but with toppings.', run: (s, st) => { addBuzz(s, st, 4, 'Pineapple referendum'); return 'Pineapple lost 23 to 19. The video got shared around town and both sides want a rematch (+Buzz).'; } },
      { id: 'half', label: 'Make them a half-and-half on the house', detail: 'About $12. Peace in our time.', run: (s, st) => { pay(s, st, 12); addBuzz(s, st, 3, 'Pineapple peace treaty'); rate(st, 0.02); return 'Half pineapple, half not, one very happy line. Diplomats should take notes (+Buzz).'; } },
      { id: 'ignore', label: 'Keep your head down', detail: 'Wise. Boring.', run: () => 'The debate burned itself out. Nobody won. Nobody ever does.' },
    ],
  },
  {
    id: 'reviewer',
    title: 'A school reporter wants an interview',
    body: (s, st) => `A high-school journalist is writing about "the best small businesses on ${loc(st).district}". She has a notebook, a deadline, and a lot of questions.`,
    options: [
      { id: 'tour', label: 'Give her the full kitchen tour', detail: 'Takes the manager off the floor for a bit.', run: (s, st) => { addBuzz(s, st, 5, 'School paper feature'); return 'She loved the dough room. The article runs next week with a photo of your oven (+Buzz).'; } },
      { id: 'quote', label: 'A quick quote and a free soda', detail: 'Short and sweet.', run: (s, st) => { pay(s, st, 2); addBuzz(s, st, 2, 'School paper quote'); return 'You got a quote in the paper: "We put love in the dough." Good line (+Buzz).'; } },
    ],
  },
  {
    id: 'power',
    title: 'The lights flicker next door',
    body: () => 'The laundromat next door lost power. Six people with wet laundry and nowhere to wait are standing outside looking at your neon sign.',
    options: [
      { id: 'invite', label: 'Invite them in, free garlic knots', detail: 'About $10.', run: (s, st) => { pay(s, st, 10); earn(s, st, 70); addBuzz(s, st, 3, 'Good neighbor'); return 'They stayed, they ordered, and the laundromat owner put your menu on their wall (+$70, +Buzz).'; } },
      { id: 'sign', label: 'Put up a "Wait here, we have Wi-Fi" sign', detail: 'Free.', run: (s, st) => { earn(s, st, 40); addBuzz(s, st, 1, 'Good neighbor'); return 'A few came in to wait and grabbed slices (+$40).'; } },
    ],
  },
  {
    id: 'mascot',
    title: 'Someone in a giant hot dog costume',
    body: () => 'A person dressed as an enormous hot dog walks in, orders a pepperoni pizza, and offers to dance outside for an hour in exchange for it. They seem very sure about this.',
    options: [
      { id: 'deal', label: 'Deal. Dance, hot dog, dance', detail: 'One free pizza. Unbeatable marketing.', run: (s, st) => { pay(s, st, 6); traffic(s, st, 1.1, 1, 'A dancing hot dog out front'); addBuzz(s, st, 4, 'Dancing hot dog'); return 'The hot dog danced. Traffic stopped. People came in out of pure confusion (+10% customers today, +Buzz).'; } },
      { id: 'pay', label: 'Just sell them the pizza', detail: 'Keep it professional.', run: (s, st) => { earn(s, st, 13); return 'One pepperoni for one hot dog. Strange day.'; } },
    ],
  },
  {
    id: 'spill',
    title: 'Soda volcano',
    body: () => 'A kid shook a soda for the entire walk from the cooler to the table. It is now on the ceiling, the floor, and his dad.',
    options: [
      { id: 'mop', label: 'Mop it up and bring a fresh one', detail: 'The store gets a bit messy for a while.', run: (s, st) => { st.cleanliness = clamp(st.cleanliness - 8, 0, 100); addBuzz(s, st, 2, 'Soda rescue'); return 'Fresh soda delivered, floor mopped (cleanliness dips a little for now, +Buzz).'; } },
      { id: 'laugh', label: 'Laugh it off with the dad', detail: 'He was already laughing.', run: (s, st) => { st.cleanliness = clamp(st.cleanliness - 12, 0, 100); crewMorale(st, 1, 'Soda volcano'); return 'Everybody laughed, nobody mopped right away (cleanliness dips).'; } },
    ],
  },
  {
    id: 'farmer',
    title: 'The basil guy',
    body: () => 'A local gardener walks in with a crate of fresh basil. "Grew way too much. You want it? Just send me home with a pizza."',
    options: [
      { id: 'trade', label: 'Trade a pizza for the basil', detail: 'Free basil.', run: (s, st) => { addStock(s, st, 'basil', 25); addBuzz(s, st, 2, 'Basil trade'); return 'Twenty-five bunches of basil for one pizza. Best deal all week (+25 basil).'; } },
      { id: 'pay', label: 'Pay him fair and keep him coming back', detail: 'About $20.', run: (s, st) => { pay(s, st, 20); addStock(s, st, 'basil', 25); rate(st, 0.01); addBuzz(s, st, 3, 'Local supplier'); return 'He\'ll be back next month with tomatoes. Customers love the local touch (+25 basil, +Buzz).'; } },
    ],
  },
  {
    id: 'rain',
    title: 'Caught in the rain',
    body: () => 'A sudden downpour sends a dozen soaked people running for the nearest door. Yours.',
    options: [
      { id: 'towels', label: 'Hand out paper towels and a smile', detail: 'Free.', run: (s, st) => { earn(s, st, 55); addBuzz(s, st, 2, 'Shelter from the storm'); return 'Most of them stayed for a slice while it poured (+$55).'; } },
      { id: 'coffee', label: 'Free hot drinks while they wait', detail: 'About $12.', run: (s, st) => { pay(s, st, 12); earn(s, st, 70); addBuzz(s, st, 4, 'Shelter from the storm'); rate(st, 0.02); return 'Warm drinks, warm pizza, warm reviews (+$70, +Buzz).'; } },
    ],
  },
  {
    id: 'chef',
    title: 'A retired chef wants a peek',
    body: () => 'A gentleman in a crisp scarf says he ran a kitchen in Naples for thirty years. He would love to watch your make line for ten minutes. Just watch. He promises.',
    options: [
      { id: 'yes', label: 'Welcome him in', detail: 'Your cooks get a few pointers.', run: (s, st) => { for (const c of st.staff.filter((x) => x.role === 'cook')) c.xp += 90; crewMorale(st, 1, 'Tips from a pro'); return 'He did not just watch. Your cooks learned three tricks and one Italian word they will not repeat (+cook experience).'; } },
      { id: 'no', label: 'Politely keep the kitchen private', detail: 'Rules are rules.', run: () => 'He nodded, ordered a margherita, and pronounced it "acceptable." High praise, probably.' },
    ],
  },
  {
    id: 'flashmob',
    title: 'Is that... a flash mob?',
    body: () => 'Eight people in matching shirts drop their menus and start dancing between the tables. One of them is holding a sign that says "MARRY ME, DEB."',
    options: [
      { id: 'music', label: 'Turn the music up', detail: 'Commit to the bit.', run: (s, st) => { addBuzz(s, st, 5, 'Flash mob venue'); traffic(s, st, 1.05, 1, 'Everyone saw the flash mob video'); return 'Deb said yes. The video is everywhere tonight (+5% customers today, +Buzz).'; } },
      { id: 'watch', label: 'Stop service for a minute and watch', detail: 'Free, and kind of beautiful.', run: (s, st) => { addBuzz(s, st, 3, 'Flash mob venue'); crewMorale(st, 2, 'Flash mob'); return 'The whole crew watched. Somebody cried. It was the dishwasher (+Buzz).'; } },
    ],
  },
  {
    id: 'competitor',
    title: 'The rival owner orders a pizza',
    body: () => 'The owner of the pizza place down the street just walked in, sunglasses on, pretending nobody knows who he is. Everybody knows who he is.',
    options: [
      { id: 'best', label: 'Make him the best pizza of his life', detail: 'Show, don\'t tell.', run: (s, st) => { addBuzz(s, st, 4, 'Out-pizza\'d the rival'); crewMorale(st, 3, 'Impressed the rival'); return 'He finished every crust, then left without a word. The crew is unbearable now, in a good way (+Buzz).'; } },
      { id: 'free', label: 'It\'s on the house, neighbor', detail: 'Classy. About $13.', run: (s, st) => { pay(s, st, 13); rate(st, 0.02); addBuzz(s, st, 3, 'Good sport'); return 'He tipped his sunglasses at you. Friendly rivalry: established (+Buzz).'; } },
    ],
  },
  {
    id: 'tourist',
    title: 'Lost tourists with a big appetite',
    body: () => 'A family of six with a map, matching visors and zero idea where they are asks for "the most local pizza you make."',
    options: [
      { id: 'tour', label: 'Recommend your best and give directions', detail: 'Friendly service.', run: (s, st) => { earn(s, st, 95); addBuzz(s, st, 2, 'Helped some tourists'); return 'Six pizzas, one hand-drawn map back to their hotel, one glowing review (+$95).'; } },
      { id: 'photo', label: 'Take their family photo out front', detail: 'Your sign ends up in a lot of albums.', run: (s, st) => { earn(s, st, 80); addBuzz(s, st, 3, 'Tourist photo spot'); return 'Your sign is now in someone\'s holiday card (+$80, +Buzz).'; } },
    ],
  },
  {
    id: 'blackout',
    title: 'The card reader is acting up',
    body: () => 'The card machine freezes for a few minutes. Customers at the counter are waving cards at it like that will help.',
    options: [
      { id: 'iou', label: '"Pay us next time," with a wink', detail: 'Most people come back. Most.', run: (s, st) => { rate(st, 0.03); addBuzz(s, st, 3, 'Pay-us-later trust'); pay(s, st, 15); return 'Almost everyone came back to pay, and they told their friends about it (+rating, a little cash lost).'; } },
      { id: 'cash', label: 'Cash only until it reboots', detail: 'A few people leave.', run: (s, st) => { rate(st, -0.01); return 'It rebooted after six long minutes. A couple of people left grumbling (rating dips slightly).'; } },
    ],
  },
  {
    id: 'cat',
    title: 'A cat is sitting in the window',
    body: () => 'A fat orange cat has claimed your front window as its sunbathing spot. People are stopping on the sidewalk to look at it.',
    options: [
      { id: 'let', label: 'Let the cat stay', detail: 'The cat was going to stay anyway.', run: (s, st) => { traffic(s, st, 1.04, 1, 'The window cat'); addBuzz(s, st, 2, 'The window cat'); return 'The cat drew a small crowd all afternoon. Several of them came in (+4% customers today).'; } },
      { id: 'shoo', label: 'Gently shoo it along', detail: 'Health code, sadly.', run: (s, st) => { rate(st, 0.01); return 'The cat left with great dignity. The health inspector would approve.'; } },
    ],
  },
  {
    id: 'oldfriend',
    title: 'Your first ever customer is back',
    body: () => 'Someone at the counter says, "You probably don\'t remember me, but I was your very first customer." They brought a photo from opening day.',
    options: [
      { id: 'wall', label: 'Put the photo on the wall and comp their meal', detail: 'About $14.', run: (s, st) => { pay(s, st, 14); crewMorale(st, 4, 'First customer came back'); addBuzz(s, st, 4, 'First customer reunion'); return 'The photo is up by the register. The crew has never been prouder (+morale, +Buzz).'; } },
      { id: 'thanks', label: 'A big thank-you and a free drink', detail: 'Warm and simple.', run: (s, st) => { pay(s, st, 2); crewMorale(st, 2, 'First customer came back'); return 'They hugged the cashier. Twice.'; } },
    ],
  },
  {
    id: 'bigorder',
    title: 'Office party, right now',
    body: () => 'Someone calls in a panic: their office party starts in forty minutes and the caterer cancelled. Can you do fifteen pizzas?',
    options: [
      { id: 'yes', label: 'Yes! All hands on deck', detail: 'Big money, busy kitchen for a bit.', run: (s, st) => { earn(s, st, 210); for (const x of st.staff) if (x.role === 'cook') x.energy = clamp(x.energy - 8, 0, 100); addBuzz(s, st, 3, 'Saved an office party'); return 'Fifteen pizzas out the door in thirty-eight minutes. The kitchen needs a sit-down (+$210, cooks a little tired).'; } },
      { id: 'some', label: 'We can do eight', detail: 'Honest and manageable.', run: (s, st) => { earn(s, st, 110); return 'Eight pizzas, delivered on time. They ordered sandwiches for the rest (+$110).'; } },
    ],
  },
  {
    id: 'kidchef',
    title: 'A kid wants to be a pizza chef',
    body: () => 'A seven-year-old stares at the make line like it\'s a rocket launch. Their mom asks, very politely, if they could watch the cook for a minute.',
    options: [
      { id: 'hat', label: 'Paper chef hat and a dough poke', detail: 'Free. Unforgettable.', run: (s, st) => { addBuzz(s, st, 4, 'Junior chef'); crewMorale(st, 2, 'Junior chef visit'); return 'One tiny chef hat, one very serious dough poke, one lifelong customer (+Buzz).'; } },
      { id: 'wave', label: 'Have the cook wave and toss the dough', detail: 'Quick show.', run: (s, st) => { addBuzz(s, st, 2, 'Dough toss show'); return 'The dough went up, the dough came down, the kid screamed with joy.'; } },
    ],
  },
  {
    id: 'secretshopper',
    title: 'Someone is taking a lot of notes',
    body: () => 'A quiet customer is timing their order on a stopwatch and photographing the soda machine. Probably a secret shopper. Probably.',
    options: [
      { id: 'normal', label: 'Treat them like everyone else', detail: 'The real test.', run: (s, st) => { const good = st.cleanliness >= 75; rate(st, good ? 0.03 : -0.01); addBuzz(s, st, good ? 3 : 0, 'Secret shopper'); return good ? 'They left a business card that said "Excellent." Just that. (+rating)' : 'They wrote "floors" and underlined it twice (rating dips slightly).'; } },
      { id: 'extra', label: 'Roll out the red carpet', detail: 'Very obvious. About $8.', run: (s, st) => { pay(s, st, 8); rate(st, 0.01); return 'They noticed. They also noticed you noticed. Awkward, but nice.'; } },
    ],
  },
  {
    id: 'musician',
    title: 'A busker sets up outside',
    body: () => 'A guitarist sets up on the sidewalk right in front of your door and starts playing. Actually pretty good. Mostly songs about cheese?',
    options: [
      { id: 'feed', label: 'Pay him in pizza to keep playing', detail: 'One pizza.', run: (s, st) => { pay(s, st, 6); traffic(s, st, 1.05, 1, 'Live music out front'); addBuzz(s, st, 2, 'Sidewalk concert'); return '"Mozzarella Moon" drew a crowd all afternoon (+5% customers today).'; } },
      { id: 'tip', label: 'Drop a tip and let him be', detail: 'About $5.', run: (s, st) => { pay(s, st, 5); crewMorale(st, 1, 'Sidewalk concert'); return 'The crew hummed "Mozzarella Moon" the rest of the shift.'; } },
    ],
  },
];

const FUN = Object.fromEntries(FUN_EVENTS.map((e) => [e.id, e])) as Record<string, FunEvent>;

/** Called each morning: every 6 to 10 days, book a fun visit for some time during service. */
export function planFunVisit(s: GameState) {
  if (s.day < 3 || !s.stores.length) return;
  s.funNext ??= s.day + randInt(s, 3, 6);
  if (s.day < s.funNext) return;
  s.funNext = s.day + randInt(s, 6, 10);
  const recent = s.funSeen ?? [];
  const pool = FUN_EVENTS.filter((e) => !recent.includes(e.id));
  const ev = pickOne(s, pool.length ? pool : FUN_EVENTS);
  s.funSeen = [...recent, ev.id].slice(-6);
  const st = pickOne(s, s.stores);
  s.scheduled.push({ kind: 'fun', storeId: st.id, at: s.day * 1440 + randInt(s, 11 * 60 + 15, 19 * 60), done: false, data: ev.id });
}

/** The visit arrives: ask the player what to do (pauses the game like other choices). */
export function funArrives(s: GameState, st: Store, id: string) {
  const ev = FUN[id];
  if (!ev || s.choice) return;
  const c: PendingChoice = {
    kind: 'fun', storeId: st.id, title: ev.title,
    body: ev.body(s, st) + (s.stores.length > 1 ? ` (${loc(st).name})` : ''),
    options: ev.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail })),
    data: { ev: id },
  };
  s.choice = c;
}

export function funResolve(s: GameState, st: Store, id: string, optionId: string): string {
  const ev = FUN[id];
  const o = ev?.options.find((x) => x.id === optionId) ?? ev?.options[0];
  if (!o) return '';
  const msg = o.run(s, st);
  news(s, `${ev.title} ${msg}`, 'good');
  return msg;
}

// ------------------------------------------------------------------ buzz and the wall of fame

export interface Accolade {
  id: string;
  /** Buzz needed. */
  at: number;
  /** Lowest rating that still gets you noticed. */
  minRating: number;
  outlet: (st: Store) => string;
  headline: (st: Store) => string;
  /** Busy days right after, and the lasting bump in foot traffic. */
  rush: [number, number];
  lasting: number;
}

export const ACCOLADES: Accolade[] = [
  { id: 'newsletter', at: 12, minRating: 3.2, outlet: (st) => `The ${loc(st).district} Neighbor newsletter`, headline: () => '"Our new favorite slice"', rush: [1.1, 2], lasting: 0.02 },
  { id: 'blog', at: 28, minRating: 3.5, outlet: () => 'Crumbs & Crust food blog', headline: () => '"The crust that ruined other crusts for me"', rush: [1.12, 3], lasting: 0.02 },
  { id: 'radio', at: 48, minRating: 3.7, outlet: () => 'KPZA morning radio', headline: () => 'Live call-in: "Who makes the best pizza in town?"', rush: [1.15, 3], lasting: 0.03 },
  { id: 'magazine', at: 75, minRating: 3.9, outlet: () => 'City Eats magazine', headline: () => '"10 pizzerias worth the drive"', rush: [1.18, 4], lasting: 0.03 },
  { id: 'tv', at: 110, minRating: 4.1, outlet: () => 'Channel 6 Morning Show', headline: (st) => `A live segment from the ${loc(st).name} kitchen`, rush: [1.25, 4], lasting: 0.04 },
  { id: 'award', at: 155, minRating: 4.3, outlet: () => 'The Golden Slice Awards', headline: () => 'Best Pizza in Town', rush: [1.25, 5], lasting: 0.05 },
  { id: 'national', at: 210, minRating: 4.5, outlet: () => 'Slice Nation (national TV)', headline: () => '"Hidden gems: the little shop that could"', rush: [1.35, 5], lasting: 0.05 },
];

/** Buzz from anything good: a great day, a passed inspection, a fun visit handled well. */
export function addBuzz(s: GameState, st: Store, v: number, why: string) {
  st.buzz = Math.max(0, (st.buzz ?? 0) + v);
  st.buzzLog = [{ day: s.day, v, why }, ...(st.buzzLog ?? [])].slice(0, 12);
  checkAccolades(s, st);
}

/** End of day: good days build a little Buzz on their own. */
export function dailyBuzz(s: GameState, st: Store) {
  const t = st.today;
  const sat = t.satCount ? t.satSum / t.satCount : 0;
  const lost = t.walkouts + t.turnedAway + t.refunds;
  let v = 0;
  if (sat >= 70) v += 1;
  if (sat >= 80) v += 1;
  if (st.rating >= 4) v += 1;
  if (t.served >= 60 && lost <= t.served * 0.06) v += 1;
  if (v) addBuzz(s, st, v, 'A great day');
}

function checkAccolades(s: GameState, st: Store) {
  const have = new Set((st.fame ?? []).map((f) => f.id));
  const next = ACCOLADES.find((a) => !have.has(a.id));
  if (!next || (st.buzz ?? 0) < next.at || st.rating < next.minRating) return;
  (st.fame ??= []).push({ id: next.id, day: s.day, outlet: next.outlet(st), headline: next.headline(st) });
  st.fameBonus = (st.fameBonus ?? 0) + next.lasting;
  s.effects.push({ kind: 'traffic', storeId: st.id, mult: next.rush[0], daysLeft: next.rush[1], label: `Featured: ${next.outlet(st)}` });
  for (const x of st.staff) x.morale = clamp(x.morale + 4, 0, 100);
  news(s, `${loc(st).name} got noticed! ${next.outlet(st)}: ${next.headline(st)}. Expect busy days (+${Math.round((next.rush[0] - 1) * 100)}% for ${next.rush[1]} days), and +${Math.round(next.lasting * 100)}% foot traffic for good.`, 'good');
  st.fameNew = s.day;
}

/** Next milestone, for the Wall of Fame. */
export function nextAccolade(st: Store): Accolade | null {
  const have = new Set((st.fame ?? []).map((f) => f.id));
  return ACCOLADES.find((a) => !have.has(a.id)) ?? null;
}

export { money };

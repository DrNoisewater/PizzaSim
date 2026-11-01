// Title-screen splash text: a random line each launch, like Minecraft's yellow text.
// Three tiers. Rarer lines get a glow (uncommon) or a holographic shimmer (rare).
// The last few lines shown are remembered on this device so repeats are rare.

export type SplashTier = 'common' | 'uncommon' | 'rare';

const COMMON = [
  'Did somebody say Hypertext Markup Language!?',
  'Living fast, eating large.',
  'Talk crusty to me.',
  'In crust we trust.',
  'You wanna pizza me?',
  '30 minutes or less!',
  'A slice a day keeps sadness away.',
  'Life happens, pizza helps.',
  'Keep your friends close, and your pizza closer.',
  'Dough not disturb.',
  'Now with 12% more cheese!',
  'Pineapple discourse not permitted on premises.',
  'Extra sauce, extra problems.',
  'The oven is always preheated in our hearts.',
  'Rendered at 450°F.',
  'Crust problems? I feel bad for you, son.',
  'Not legally a vegetable.',
  "Ask about our loyalty program! (We don't have one.)",
  "Fold it. Don't tell anyone.",
  'Now hiring! Always. Forever.',
  "Please don't lean on the makeline.",
  'Slice to meet you!',
  '100% organic pixels.',
  'Delivery driver has the right of way.',
  "The truck order isn't going to place itself.",
  'Morale is mostly carbohydrates.',
  'Order up!',
  'Have you tried turning the oven off and on again?',
  'Now 40% less floor sauce.',
  "Crust me, I'm a professional.",
  'Made with love and a suspicious amount of oregano.',
  'Labor: 28%. Vibes: 100%.',
  'Someone left a garlic knot in the register.',
  'Box it like you mean it.',
  'Fresh dough daily. Fresh disasters hourly.',
  'Now with 100% more inspectors.',
];

const UNCOMMON = [
  '"There\'s no better feeling in the world than a warm pizza box on your lap." – Kevin James',
  '"You better cut the pizza in four pieces because I\'m not hungry enough to eat six." – Yogi Berra',
  'Every pizza is a personal pizza if you believe in yourself.',
  'Slimy, yet satisfying!',
  '"Forgiveness is divine, but never pay full price for late pizza." – Michelangelo',
  'Another one bites the crust.',
  'Slice, slice, baby.',
  'Pizza Time',
  'French fries and Oreos, you know me all too well.',
  'Logan is watching. Wipe that counter.',
  'Five stars or bust.',
  'This splash text was cooked at 450°F.',
  'A wild critic appears!',
  'You found the extra-cheesy splash.',
];

const RARE = [
  "Where's My Brownie!",
  'Headed to Lebanon',
  'Can I get a hand over here...?',
  'Full Menu',
  'Did you grab your sauces?',
  'Fill your pockets with Dough!',
  'Robust-Inspired!',
  'Our little slice of heaven...',
  "Big Lou's just like you.",
  'Running a Tight Ship',
  "My sister's dad loves it",
  '"To eat, or not to eat" – (probably) Shakespeare',
  "You'll never see this one again. Probably.",
  'Grease is the word.',
];

const POOLS: Record<SplashTier, string[]> = { common: COMMON, uncommon: UNCOMMON, rare: RARE };
const KEY = 'pizzasim.splashSeen';
const REMEMBER = 30;

function seen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(text: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([text, ...seen().filter((x) => x !== text)].slice(0, REMEMBER)));
  } catch {
    /* private window or blocked storage: repeats are fine */
  }
}

/** Pick a splash: about 1 in 6 is uncommon, 1 in 25 is rare. Skips lines shown recently. */
export function pickSplash(): { text: string; tier: SplashTier } {
  const r = Math.random();
  const tier: SplashTier = r < 0.04 ? 'rare' : r < 0.2 ? 'uncommon' : 'common';
  const recent = new Set(seen());
  const pool = POOLS[tier];
  const fresh = pool.filter((x) => !recent.has(x));
  const from = fresh.length ? fresh : pool;
  const text = from[Math.floor(Math.random() * from.length)];
  remember(text);
  return { text, tier };
}

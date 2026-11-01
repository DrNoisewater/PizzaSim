// Names and review lines. All original copy.

export const FIRST_NAMES = [
  'Marco', 'Gina', 'Luca', 'Rosa', 'Tony', 'Sofia', 'Dante', 'Aria', 'Enzo', 'Mia', 'Nico', 'Lena', 'Sal', 'Bea',
  'Omar', 'Priya', 'Jamal', 'Keiko', 'Diego', 'Hana', 'Theo', 'Zoe', 'Ravi', 'Ines', 'Felix', 'Maya', 'Owen', 'Tess',
  'Kofi', 'Yara', 'Sam', 'Lucia', 'Ben', 'Nina', 'Mateo', 'Ava', 'Hugo', 'Elif', 'Leo', 'Ruth', 'Andre', 'Wren',
  'Paolo', 'Daria', 'Chen', 'Ola', 'Ivan', 'Noor',
];
export const LAST_INITIALS = 'ABCDEFGHJKLMNOPRSTVWYZ';

export type ReviewTopic = 'slow' | 'fast' | 'tasty' | 'bland' | 'pricey' | 'value' | 'dirty' | 'vibe' | 'deliveryFast' | 'deliverySlow' | 'soldout' | 'walkout' | 'refund';

/** Lines about what drove the verdict. {item} = something they ordered, {wait} = minutes. */
export const REVIEW_LINES: Record<ReviewTopic, string[]> = {
  slow: [
    'Waited {wait} minutes for my order.', 'The {item} was fine. The {wait}-minute wait was not.', 'Slow service tonight. Bring a book.',
    'Watched three other tables get fed before us.', 'By the time the {item} showed up I had forgotten what I ordered.', 'Kitchen seemed swamped. {wait} minutes, start to finish.',
    'Good pizza, glacial service.', 'I aged visibly waiting for that {item}.',
  ],
  fast: [
    'In and out in {wait} minutes.', 'Order was up before I sat down.', 'Fastest pizza on the block.', 'Lunch break saved. {item} in hand in no time.',
    'Barely had time to check my phone.', 'Quick, friendly, done.', 'They had my {item} out while I was still filling my drink.',
  ],
  tasty: [
    'Best crust in town, hands down.', 'That cheese pull! Coming back tomorrow.', 'Perfect char on the {item}.', 'Honestly better than the place my nonna liked.',
    'Bubbly crust, bright sauce. Loved it.', 'The {item} had a proper leopard-spotted crust.', 'Ate the crusts. I never eat the crusts.', 'Toppings all the way to the edge on the {item}.',
    'Sauce tasted like actual tomatoes. Wild concept.', 'I would fight someone for another slice of that {item}.',
  ],
  bland: [
    'The {item} was kind of flavorless.', 'Crust tasted like cardboard.', 'Toppings were skimpy and sad.', 'Fine if you are very hungry.',
    'The {item} needed salt, cheese, and a reason to exist.', 'Soggy middle on the {item}.', 'Tasted like it was made by someone on their first day.', 'Lukewarm and limp.',
  ],
  pricey: [
    'Tasty but way overpriced.', 'Prices are getting silly.', '{price} for that? No thanks.', 'Good {item}, but my wallet is still crying.',
    'Charging airport prices on a regular street.', 'Paid {price}. Expected more.', 'Love the place, hate the prices.',
  ],
  value: [
    'Great pizza for the price.', 'Cheap, hot and good. What else do you want?', 'Feeds the whole family without breaking the bank.', '{price} well spent.',
    'The special was a steal.', 'Honest prices, honest pizza.', 'Cheaper than cooking, and better.',
  ],
  dirty: [
    'Tables were sticky. Gross.', 'Somebody please mop that floor.', 'Food was ok but the place was a mess.', 'Had to wipe my own table.',
    'There was someone else\'s crust on my chair.', 'The {item} was good. The floor was crunchy.',
  ],
  vibe: [
    'Love the vibe in here.', 'Cute spot for a date night.', 'Great music, great room, great slice.', 'The decor alone is worth the trip.',
    'Felt like a little trattoria.', 'Cozy. Stayed way longer than planned.',
  ],
  deliveryFast: [
    'Arrived hot and fast!', 'Driver was quick and friendly.', 'Still steaming when it got here.', '{wait} minutes door to door. Impressive.',
    'The {item} beat the movie trailer.', 'Driver knew a shortcut, apparently.',
  ],
  deliverySlow: [
    'Delivery showed up cold.', 'Took forever to arrive.', 'Driver must have taken the scenic route.', '{wait} minutes for delivery. The {item} gave up halfway.',
    'Called twice to check on it.', 'Box was warmer than the pizza.',
  ],
  soldout: ['They were out of what I wanted.', 'Half the menu was sold out.', 'No {item} today, apparently.', 'Came for one thing. They didn\'t have it.'],
  walkout: ['Line was too long, gave up.', 'Nobody at the counter. Left.', 'Stood in line for ages and walked out hungry.', 'One person on the till and a line out the door.'],
  refund: ['Never got my food. Had to ask for a refund.', 'Gave up waiting and got my money back.', 'Paid, waited, waited more, got refunded.', 'They lost my order somewhere.'],
};

/** How a review opens, by star band (0 = 1 star ... 4 = 5 stars). */
export const REVIEW_OPEN: string[][] = [
  ['Never again.', 'Wow. Not in a good way.', 'One star because zero isn\'t allowed.', 'Big disappointment.', ''],
  ['Not great.', 'Meh.', 'Expected better.', 'Mixed bag, mostly bad.', ''],
  ['It was okay.', 'Decent, not memorable.', 'Fine, I guess.', 'Middle of the road.', ''],
  ['Solid spot.', 'Pretty good!', 'Would come back.', 'Nice surprise.', ''],
  ['Wow!', 'New favorite.', 'Five stars, no notes.', 'Instant regular.', 'Chef\'s kiss.', ''],
];
/** Optional sign-off, by star band. */
export const REVIEW_CLOSE: string[][] = [
  ['Avoid.', 'Save your money.', '', '', ''],
  ['Maybe on a slow day.', '', '', ''],
  ['', '', 'It\'s fine for a weeknight.', ''],
  ['Will be back.', 'Tell your friends.', '', ''],
  ['10/10.', 'Already planning my next visit.', 'Tell your friends.', '', ''],
];

/** What a reviewer saw: shown when the review card is opened. */
export interface ReviewDetail {
  kind: 'dine' | 'takeout' | 'delivery';
  items: string[];
  paid: number;
  /** Minutes from order to food (or in line, for walkouts). */
  wait: number;
  quote?: number;
  /** Average food quality 0-100. */
  quality?: number;
  /** Price paid vs fair, as a ratio. */
  priceRatio?: number;
  clean?: number;
  /** Top factors behind the score: label and points. */
  factors?: [string, number][];
  /** The kind of customer, if they weren't average ("Neat freak"). */
  who?: string;
}

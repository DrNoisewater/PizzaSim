// Studio, version and credits. Keep VERSION in sync with package.json.
export const STUDIO = 'Noisewater Labs';
export const VERSION = '0.4.3';
export const BUILD_NAME = 'Slice of Life';
export const BUILD_DATE = 'October 2026';
export const PLAYTESTERS = ['Logan Taylor', 'Ian McQueen'];

/**
 * Who holds what share of the pie, as a percentage (shown in the credits as a pizza icon that
 * fills to that share; the numbers themselves are not shown). Any percentage works, e.g. 18.75 = 1.5 of 8 slices.
 * The studio automatically holds whatever is left over. Shares are laid out clockwise from
 * 12 o'clock: the studio first, then each person in list order.
 */
export const PIE_SLICES = 8; // cut lines drawn on the pizza
export const PIE_SHARES: { name: string; percent: number; role: 'studio' | 'playtester'; note?: string }[] = [
  { name: 'Logan Taylor', percent: 12.5, role: 'playtester', note: 'Also appears in-game as Inspector Logan' },
  { name: 'Ian McQueen', percent: 12.5, role: 'playtester' },
];

/** Where playtester feedback is delivered (not shown in the game). */
/** The rare food critic (the studio's own reference photos). */
export const CRITIC_NAME = 'Anton Ego';
export const CRITIC_PAPER = 'The Gilded Fork';

export const FEEDBACK_TO = 'jferguson2194@hotmail.com';

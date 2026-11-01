// Locations, marketing, staff roles & traits, weather, loans.
import type { ItemId } from './catalog';

export type LocationId = 'maple' | 'campus' | 'downtown' | 'harbor' | 'airport';
export type CurveId = 'default' | 'late' | 'lunch' | 'tourist' | 'flat';
export type EnvId = 'suburb' | 'campus' | 'city' | 'harbor' | 'airport';

/** Demand multipliers for each opening hour, 10:00 through 21:00. */
export const HOUR_CURVES: Record<CurveId, number[]> = {
  default: [0.35, 0.7, 1.5, 1.4, 0.7, 0.5, 0.6, 1.0, 1.6, 1.7, 1.3, 0.8],
  late: [0.3, 0.6, 1.2, 1.1, 0.7, 0.6, 0.7, 1.0, 1.4, 1.6, 1.6, 1.5],
  lunch: [0.5, 1.1, 2.2, 2.0, 0.8, 0.5, 0.6, 0.9, 1.1, 1.0, 0.7, 0.4],
  tourist: [0.4, 0.8, 1.4, 1.5, 1.2, 1.0, 1.0, 1.2, 1.6, 1.6, 1.3, 0.9],
  flat: [1.0, 1.1, 1.3, 1.3, 1.1, 1.0, 1.0, 1.1, 1.3, 1.2, 1.0, 0.8],
};

export interface LocationDef {
  id: LocationId;
  name: string;
  district: string;
  cost: number;
  reqLevel: number;
  rent: number;
  /** Base customers per hour at curve 1.0 and a 3-star rating. */
  traffic: number;
  priceSens: number;
  /** What locals think a pizza is worth here (1 = suburban prices). */
  priceLevel: number;
  patience: number;
  deliveryShare: number;
  deliveryDist: number;
  weekendBoost: number;
  weatherSens: number;
  prefs: Partial<Record<ItemId, number>>;
  curve: CurveId;
  env: EnvId;
  blurb: string;
}

export const LOCATIONS: LocationDef[] = [
  { id: 'maple', name: 'Maple Street', district: 'Suburbs', cost: 0, reqLevel: 1, rent: 280, traffic: 9, priceSens: 1, priceLevel: 1, patience: 1, deliveryShare: 0.3, deliveryDist: 1, weekendBoost: 1.1, weatherSens: 1, prefs: { pepperoni: 1.1, margherita: 1.1, hawaiian: 1.1 }, curve: 'default', env: 'suburb', blurb: 'Quiet street, family crowd, steady dinners.' },
  { id: 'campus', name: 'Campus Corner', district: 'University', cost: 11500, reqLevel: 3, rent: 380, traffic: 12, priceSens: 1.5, priceLevel: 0.92, patience: 1.1, deliveryShare: 0.45, deliveryDist: 0.8, weekendBoost: 1.0, weatherSens: 1, prefs: { pepperoni: 1.3, hawaiian: 1.3, knots: 1.4, soda: 1.3, supreme: 0.8 }, curve: 'late', env: 'campus', blurb: 'Hungry students, tight budgets, late nights.' },
  { id: 'downtown', name: 'Downtown Plaza', district: 'Business District', cost: 32000, reqLevel: 6, rent: 640, traffic: 17, priceSens: 0.75, priceLevel: 1.08, patience: 0.75, deliveryShare: 0.32, deliveryDist: 0.9, weekendBoost: 0.75, weatherSens: 0.8, prefs: { margherita: 1.2, veggie: 1.3, bianca: 1.4 }, curve: 'lunch', env: 'city', blurb: 'Huge lunch rush. Office workers hate waiting.' },
  { id: 'harbor', name: 'Harbor Boardwalk', district: 'Waterfront', cost: 65000, reqLevel: 9, rent: 900, traffic: 19, priceSens: 0.6, priceLevel: 1.15, patience: 1, deliveryShare: 0.15, deliveryDist: 1.2, weekendBoost: 1.5, weatherSens: 1.6, prefs: { supreme: 1.3, bbqchicken: 1.3, meatlovers: 1.2, calzone: 1.2 }, curve: 'tourist', env: 'harbor', blurb: 'Tourists pay more. Weather makes or breaks the day.' },
  { id: 'airport', name: 'Airport Terminal B', district: 'Airport', cost: 130000, reqLevel: 12, rent: 1500, traffic: 26, priceSens: 0.3, priceLevel: 1.3, patience: 0.65, deliveryShare: 0, deliveryDist: 1, weekendBoost: 1.05, weatherSens: 0.2, prefs: { calzone: 1.4, margherita: 1.1 }, curve: 'flat', env: 'airport', blurb: 'Endless foot traffic, premium prices, zero patience.' },
];
export const LOC: Record<LocationId, LocationDef> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l])) as Record<LocationId, LocationDef>;

export type CampaignId = 'flyers' | 'social' | 'coupon' | 'radio' | 'billboard' | 'tv';
export interface CampaignDef {
  id: CampaignId;
  name: string;
  cost: number;
  days: number;
  boost: number;
  deliveryBoost?: number;
  priceMult?: number;
  req: number;
  desc: string;
}
export const CAMPAIGNS: CampaignDef[] = [
  { id: 'flyers', name: 'Flyer Drop', cost: 120, days: 3, boost: 0.12, req: 1, desc: '+12% customers for 3 days.' },
  { id: 'social', name: 'Social Media Ads', cost: 380, days: 5, boost: 0.22, deliveryBoost: 0.2, req: 2, desc: '+22% customers, +20% delivery orders for 5 days.' },
  { id: 'coupon', name: 'Coupon Day', cost: 0, days: 1, boost: 0.6, priceMult: 0.8, req: 3, desc: '+60% customers today, but everything is 20% off.' },
  { id: 'radio', name: 'Local Radio Spot', cost: 950, days: 7, boost: 0.35, req: 4, desc: '+35% customers for 7 days.' },
  { id: 'billboard', name: 'Billboard', cost: 2300, days: 14, boost: 0.45, req: 7, desc: '+45% customers for 14 days.' },
  { id: 'tv', name: 'TV Commercial', cost: 6500, days: 7, boost: 0.85, deliveryBoost: 0.3, req: 8, desc: '+85% customers for 7 days.' },
];
export const CAMPAIGN: Record<CampaignId, CampaignDef> = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c])) as Record<CampaignId, CampaignDef>;

export const LOYALTY = { cost: 1500, req: 5, boost: 0.12, dailyFee: 15 };

export type Role = 'cook' | 'front' | 'driver' | 'manager';
export const ROLES: Record<Role, { name: string; plural: string; baseWage: number; perSkill: number; req: number; desc: string; color: string }> = {
  // 0.3.29: pay from a real pizza shop. Insiders $13–15, kitchen $13–18 (rising with training),
  // drivers $11 in the store and $7 on the road (tips and mileage make up the rest, and aren't
  // labor cost), managers about $19–23.
  cook: { name: 'Kitchen Crew', plural: 'Kitchen crew', baseWage: 13, perSkill: 1.25, req: 1, desc: 'Builds pizzas on the make line and loads the oven. Covers the register when nobody else can.', color: '#f4f1ea' },
  front: { name: 'Front of House', plural: 'Front of house', baseWage: 13, perSkill: 0.5, req: 1, desc: 'Takes orders at the till, runs food to tables, buses dirty tables and keeps the floor clean.', color: '#d8402b' },
  driver: { name: 'Driver', plural: 'Drivers', baseWage: 11, perSkill: 0.25, req: 2, desc: 'Delivers orders: in-store pay while inside, a lower road rate while driving, plus tips and mileage from customers.', color: '#2f6fd1' },
  manager: { name: 'Manager', plural: 'Managers', baseWage: 18, perSkill: 1.25, req: 4, desc: 'Runs the shift: lifts everyone\'s speed and morale, covers call-offs, can auto-order stock and cuts waste. Hire two or three so every shift has one.', color: '#2b2724' },
};
/** What drivers earn per hour while out on a delivery (tips and mileage come on top, from customers). */
export const DRIVER_ROAD_WAGE = 7;
/** Mileage paid to drivers per delivery trip (a running cost, not labor). */
export const MILEAGE_PER_TRIP = 1.1;
/** Most managers one store can have. */
export const MAX_MANAGERS = 3;
/** Pay rate for hours past 40 in a week. */
export const OVERTIME_MULT = 1.5;
export const WEEK_HOURS = 40;
/** Wage tables before 0.3.29, for rescaling old saves. */
export const OLD_WAGES: Record<Role, [number, number]> = { cook: [13, 3.25], front: [12, 2.75], driver: [12.5, 2.75], manager: [21.5, 4] };
/** Old saves used these roles; they map onto the merged ones. */
export const LEGACY_ROLE: Record<string, Role> = { cashier: 'front', cleaner: 'front' };

export type ShiftId = 'lunch' | 'dinner' | 'mid' | 'evening' | 'full' | 'open8' | 'close8';
/** Opening hours each shift covers (minutes since midnight). Full-day staff stay to finish the last orders. */
export const SHIFTS: Record<ShiftId, { name: string; short: string; start: number; end: number; desc: string }> = {
  lunch: { name: 'Morning', short: 'Morn', start: 10 * 60, end: 16 * 60, desc: '10 AM to 4 PM. 6 paid hours.' },
  dinner: { name: 'Dinner', short: 'Dinner', start: 16 * 60, end: 22 * 60, desc: '4 PM to close. 6 paid hours.' },
  mid: { name: 'Lunch Rush', short: 'L-Rush', start: 11 * 60, end: 15 * 60, desc: '11 AM to 3 PM. 4 paid hours, covers the lunch peak.' },
  evening: { name: 'Dinner Rush', short: 'D-Rush', start: 17 * 60, end: 21 * 60, desc: '5 PM to 9 PM. 4 paid hours, covers the dinner peak.' },
  full: { name: 'OP-CL', short: 'OP-CL', start: 10 * 60, end: 22 * 60, desc: 'Open to close, 10 AM to 10 PM. 12 paid hours: expensive and tiring.' },
  open8: { name: 'Opener', short: 'Open', start: 10 * 60, end: 18 * 60, desc: '10 AM to 6 PM. 8 paid hours, a full day: lunch and the start of dinner.' },
  close8: { name: 'Closer', short: 'Close', start: 14 * 60, end: 22 * 60, desc: '2 PM to close. 8 paid hours, a full day: the afternoon and the dinner rush.' },
};
/** Order shown in the shift picker: open-to-close first (it's the odd one out), then through the day. */
export const SHIFT_ORDER: ShiftId[] = ['open8', 'close8', 'lunch', 'mid', 'dinner', 'evening', 'full'];
/** Store hours, for display. */
export const HOURS_LABEL = 'Open 10 AM to 10 PM';
export const shiftHours = (id: ShiftId) => (SHIFTS[id].end - SHIFTS[id].start) / 60;

export type TraitId =
  | 'speedy' | 'charming' | 'upseller' | 'perfectionist' | 'clumsy' | 'steady' | 'reliable' | 'slacker' | 'veteran'
  | 'nightowl' | 'tidy' | 'navigator' | 'mentor' | 'earlybird' | 'teamplayer' | 'ambitious' | 'multitasker' | 'grumpy' | 'sensitive' | 'diamond' | 'leader';
/** roles: who can have (and use) the trait. Omitted = everyone. */
export const TRAITS: Record<TraitId, { name: string; good: boolean; desc: string; roles?: Role[] }> = {
  speedy: { name: 'Quick Hands', good: true, desc: '+15% work speed.' },
  charming: { name: 'Charming', good: true, desc: 'Customers they serve are happier.', roles: ['front', 'driver', 'manager'] },
  upseller: { name: 'Upseller', good: true, desc: 'Sells more sides and drinks at the till.', roles: ['front', 'manager'] },
  perfectionist: { name: 'Perfectionist', good: true, desc: 'Better pizzas, a little slower.', roles: ['cook'] },
  clumsy: { name: 'Butterfingers', good: false, desc: 'Drops pizzas four times as often as everyone else.', roles: ['cook', 'front'] },
  steady: { name: 'Steady Hands', good: true, desc: 'Never drops a pizza.', roles: ['cook', 'front'] },
  reliable: { name: 'Reliable', good: true, desc: 'Never calls in sick. Morale drops half as fast.' },
  slacker: { name: 'Slacker', good: false, desc: '-15% work speed.' },
  veteran: { name: 'Quick Learner', good: true, desc: 'Gains experience 50% faster.' },
  nightowl: { name: 'Night Owl', good: true, desc: '+10% speed after 6 PM.' },
  tidy: { name: 'Neat Freak', good: true, desc: 'Cleans and buses tables twice as fast.', roles: ['front'] },
  navigator: { name: 'Knows Shortcuts', good: true, desc: 'Deliveries take 20% less time.', roles: ['driver'] },
  mentor: { name: 'Mentor', good: true, desc: 'Everyone on shift learns 25% faster.', roles: ['manager'] },
  earlybird: { name: 'Early Bird', good: true, desc: '+10% speed before 2 PM.' },
  teamplayer: { name: 'Team Player', good: true, desc: 'Coworkers on the same shift gain +1 morale a night.' },
  ambitious: { name: 'Ambitious', good: true, desc: 'Learns 25% faster, but gets restless if paid at or below market.' },
  multitasker: { name: 'Multitasker', good: true, desc: 'Rings up orders 20% faster.', roles: ['front', 'manager'] },
  grumpy: { name: 'Grumpy', good: false, desc: 'Customers they serve are a little less happy.', roles: ['front', 'driver', 'manager'] },
  sensitive: { name: 'Thin-Skinned', good: false, desc: 'Bad days hit their morale 50% harder.' },
  diamond: { name: 'Diamond in the Rough', good: true, desc: 'Learns twice as fast, gets more out of training (half price) and stays upbeat. Hard to spot on an application.' },
  leader: { name: 'Natural Born Leader', good: true, desc: 'From skill 2, lifts everyone on shift with them: +2% speed per skill level above 1 (up to +8%).' },
};
// Rare traits: roll on their own, about 1 applicant in 30.
export const RARE_TRAITS: TraitId[] = ['diamond', 'leader'];
export const traitFits = (t: TraitId, role: Role) => !TRAITS[t].roles || TRAITS[t].roles!.includes(role);

export type WeatherId = 'sunny' | 'cloudy' | 'rainy' | 'hot';
export const WEATHER: Record<WeatherId, { name: string; walk: number; delivery: number; drinks: number }> = {
  sunny: { name: 'Sunny', walk: 1.06, delivery: 0.9, drinks: 1.1 },
  cloudy: { name: 'Cloudy', walk: 1, delivery: 1, drinks: 1 },
  rainy: { name: 'Rain', walk: 0.7, delivery: 1.6, drinks: 0.9 },
  hot: { name: 'Heatwave', walk: 0.92, delivery: 1.1, drinks: 1.8 },
};

export const LOANS = [
  { amount: 2000, req: 1 },
  { amount: 8000, req: 3 },
  { amount: 25000, req: 6 },
  { amount: 75000, req: 10 },
];
/** Base flat interest; difficulty scales it. */
export const LOAN_INTEREST = 0.1;
export const LOAN_DAYS = 20;

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_TRAFFIC = [0.85, 0.85, 0.95, 1.0, 1.25, 1.35, 1.1];

export const OPEN_MIN = 10 * 60;
export const CLOSE_MIN = 22 * 60;
export const HARD_CLOSE_MIN = 23 * 60 + 30;
export const PREP_MIN = 9 * 60;
export const MAX_STAFF = 16;
/** Job ad: more and better applicants for a few days. */
export const JOB_AD = { cost: 150, days: 3 };
/** Flat fee added to every delivery order. */
export const DELIVERY_FEE = 2.99;
/** Default discount on a special. */
export const SPECIAL_DISCOUNT = 0.15;
export type SpecialWindow = 'morning' | 'evening' | 'all';
export const SPECIAL_WINDOWS: Record<SpecialWindow, { name: string; short: string; start: number; end: number }> = {
  morning: { name: 'Lunch (open to 4 PM)', short: 'Lunch', start: 0, end: 16 * 60 },
  evening: { name: 'Dinner (4 PM to close)', short: 'Dinner', start: 16 * 60, end: 99 * 60 },
  all: { name: 'All day', short: 'All day', start: 0, end: 99 * 60 },
};
export const SPECIAL_PCTS = [10, 15, 25, 40];
export const MAX_SPECIALS = 3;

// Per-store equipment upgrades. Level 0 is what a new store starts with.

export type UpgradeId =
  | 'oven' | 'prep' | 'register' | 'storage' | 'dining' | 'decor' | 'sign'
  | 'delivery' | 'online' | 'cleaning' | 'breakroom' | 'software';

export interface UpgradeLevel {
  name: string;
  cost: number;
  req: number;
  desc: string;
  // stats (only the relevant ones are set per category)
  slots?: number;
  bakeTime?: number;
  quality?: number;
  stations?: number;
  speed?: number;
  orderTime?: number;
  tills?: number;
  kiosk?: boolean;
  /** Number of self-order kiosks (newer levels; kiosk: true means one). */
  kiosks?: number;
  capacity?: number;
  shelfBonus?: number;
  seats?: number;
  ambience?: number;
  traffic?: number;
  vehicleCap?: number;
  vehicleSpeed?: number;
  onlineMult?: number;
  decay?: number;
  cleanSpeed?: number;
  morale?: number;
  energy?: number;
  autoReorder?: boolean;
  /** Forecast error band in percent (Inventory System). */
  accuracy?: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  group: 'Kitchen' | 'Front of house' | 'Growth' | 'Back office';
  levels: UpgradeLevel[];
  /** Upgrade that must be at least level 1 first. */
  needs?: UpgradeId;
}

// 0.3.22: early and middle steps are a bit cheaper and arrive a level sooner, storage is trimmed
// a little (the truck and forecast do more of the work now), and most ladders get one or two
// late steps (levels 9-13) so there's always something worth saving for in every store.
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'oven', name: 'Oven', group: 'Kitchen', levels: [
      { name: 'Deck Oven', cost: 0, req: 1, slots: 3, bakeTime: 7, quality: 0, desc: '3 pizzas at a time, 7 min bake (about 25 an hour).' },
      { name: 'Double Deck Oven', cost: 1200, req: 2, slots: 5, bakeTime: 6.5, quality: 2, desc: '5 pizzas at once, 6.5 min bake (about 45 an hour).' },
      { name: 'Conveyor Oven', cost: 3300, req: 4, slots: 6, bakeTime: 4.5, quality: 4, desc: '6 pizzas on the belt, 4.5 min bake (about 80 an hour).' },
      { name: 'Wood-Fired Dome', cost: 8500, req: 7, slots: 8, bakeTime: 3.5, quality: 12, desc: '8 pizzas, 3.5 min bake (about 135 an hour), leopard-spotted crust (+quality).' },
      { name: 'Grand Dome', cost: 16000, req: 11, slots: 11, bakeTime: 3.3, quality: 15, desc: '11 pizzas, 3.3 min bake (about 200 an hour). The best crust in town.' },
    ],
  },
  {
    id: 'prep', name: 'Make Line', group: 'Kitchen', levels: [
      { name: 'Prep Table', cost: 0, req: 1, stations: 1, speed: 1, desc: 'Room for 1 kitchen crew member.' },
      { name: 'Twin Prep Line', cost: 600, req: 1, stations: 2, speed: 1, desc: 'Room for 2 kitchen crew.' },
      { name: 'Pro Make Line', cost: 1700, req: 3, stations: 3, speed: 1.1, desc: '3 stations, chilled topping rail (+10% speed).' },
      { name: "Chef's Line", cost: 3900, req: 5, stations: 4, speed: 1.2, desc: '4 stations, everything in reach (+20% speed).' },
      { name: "Chef's Line Pro", cost: 8200, req: 9, stations: 4, speed: 1.35, desc: '4 stations, a second topping rail and sauce dispensers (+35% speed).' },
    ],
  },
  {
    id: 'register', name: 'Register', group: 'Front of house', levels: [
      { name: 'Cash Box', cost: 0, req: 1, orderTime: 1.6, tills: 1, desc: 'One till. Orders take a while to ring up.' },
      { name: 'POS Terminals', cost: 550, req: 1, orderTime: 1.1, tills: 2, desc: 'Two tills, faster ringing up.' },
      { name: 'Touchscreen POS + Kiosk', cost: 2300, req: 3, orderTime: 0.8, tills: 2, kiosks: 1, desc: 'Two fast tills plus a self-order kiosk.' },
      { name: 'Third Till', cost: 4200, req: 6, orderTime: 0.75, tills: 3, kiosks: 1, desc: 'Three fast tills and the kiosk. Spare tills speed up the others too.' },
      { name: 'Kiosk Wall', cost: 7800, req: 9, orderTime: 0.7, tills: 3, kiosks: 2, desc: 'Three tills and two self-order kiosks for the big rushes.' },
    ],
  },
  {
    id: 'storage', name: 'Storage', group: 'Back office', levels: [
      { name: 'Pantry Fridge', cost: 0, req: 1, capacity: 420, shelfBonus: 0, desc: '420 units of cold storage: a busy day plus a little extra.' },
      { name: 'Reach-in Fridge', cost: 400, req: 1, capacity: 700, shelfBonus: 0, desc: '700 units. Room for a weekend rush.' },
      { name: 'Double Fridge', cost: 1000, req: 2, capacity: 1000, shelfBonus: 0, desc: '1,000 units. Order two days at a time.' },
      { name: 'Walk-in Cooler', cost: 2100, req: 4, capacity: 1550, shelfBonus: 1, desc: '1,550 units, fresh stock lasts +1 day.' },
      { name: 'Cold Room', cost: 4600, req: 7, capacity: 2400, shelfBonus: 2, desc: '2,400 units, fresh stock lasts +2 days.' },
    ],
  },
  {
    id: 'dining', name: 'Dining Room', group: 'Front of house', levels: [
      { name: 'Two Tables', cost: 0, req: 1, seats: 4, desc: '4 seats.' },
      { name: 'Cozy Corner', cost: 800, req: 1, seats: 8, desc: '8 seats.' },
      { name: 'Full Dining Room', cost: 2200, req: 3, seats: 12, desc: '12 seats.' },
      { name: 'Grand Hall', cost: 4600, req: 5, seats: 16, desc: '16 seats.' },
    ],
  },
  {
    id: 'decor', name: 'Decor', group: 'Front of house', levels: [
      { name: 'Bare Walls', cost: 0, req: 1, ambience: 0, desc: 'Concrete floor, plain walls.' },
      { name: 'Fresh Paint & Plants', cost: 400, req: 1, ambience: 1, desc: 'A little life. +ambience, +patience.' },
      { name: 'Checkered Classic', cost: 1150, req: 2, ambience: 2, desc: 'Black and white tiles, framed prints.' },
      { name: 'Retro Neon', cost: 2800, req: 4, ambience: 3, desc: 'Brick, neon and a jukebox.' },
      { name: 'Trattoria Deluxe', cost: 6800, req: 8, ambience: 4, desc: 'Oak floors, pendant lights, the works.' },
    ],
  },
  {
    id: 'sign', name: 'Street Sign', group: 'Growth', levels: [
      { name: 'Sidewalk Board', cost: 0, req: 1, traffic: 0, desc: 'Chalk on a sandwich board.' },
      { name: 'Lightbox Sign', cost: 500, req: 1, traffic: 0.08, desc: '+8% foot traffic.' },
      { name: 'Neon Pylon', cost: 1400, req: 3, traffic: 0.18, desc: '+18% foot traffic. Glows at night.' },
      { name: 'Giant Spinning Slice', cost: 3700, req: 5, traffic: 0.3, desc: '+30% foot traffic. A landmark.' },
      { name: 'Slice in Lights', cost: 8500, req: 10, traffic: 0.38, desc: '+38% foot traffic. They can see it from the highway.' },
    ],
  },
  {
    id: 'delivery', name: 'Delivery', group: 'Growth', levels: [
      { name: 'No Delivery', cost: 0, req: 1, vehicleCap: 0, vehicleSpeed: 1, desc: 'Walk-ins only.' },
      { name: 'Bicycle', cost: 700, req: 2, vehicleCap: 1, vehicleSpeed: 1, desc: 'Unlocks delivery orders. Needs a driver.' },
      { name: 'Scooter', cost: 1850, req: 4, vehicleCap: 2, vehicleSpeed: 0.75, desc: '2 orders per trip, 25% faster.' },
      { name: 'Electric Van', cost: 4800, req: 6, vehicleCap: 4, vehicleSpeed: 0.65, desc: '4 orders per trip, 35% faster.' },
      { name: 'Delivery Fleet', cost: 9500, req: 11, vehicleCap: 5, vehicleSpeed: 0.55, desc: '5 orders per trip, 45% faster, routed by the app.' },
    ],
  },
  {
    id: 'online', name: 'Online Ordering', group: 'Growth', needs: 'delivery', levels: [
      { name: 'Phone Orders', cost: 0, req: 1, onlineMult: 1, desc: 'Customers call in.' },
      { name: 'Website Ordering', cost: 1150, req: 3, onlineMult: 1.45, desc: '+45% delivery orders.' },
      { name: 'Mobile App', cost: 3400, req: 5, onlineMult: 1.95, desc: '+95% delivery orders.' },
      { name: 'Rewards App', cost: 7000, req: 10, onlineMult: 2.35, desc: '+135% delivery orders. Points, streaks, the works.' },
    ],
  },
  {
    id: 'cleaning', name: 'Cleaning Gear', group: 'Back office', levels: [
      { name: 'Mop & Bucket', cost: 0, req: 1, decay: 1, cleanSpeed: 1, desc: 'The basics.' },
      { name: 'Dishwasher', cost: 600, req: 2, decay: 0.75, cleanSpeed: 1.4, desc: 'Gets dirty 25% slower, tables bus 40% faster.' },
      { name: 'Floor Scrubber', cost: 1700, req: 4, decay: 0.5, cleanSpeed: 1.8, desc: 'Gets dirty 50% slower, cleaning 80% faster.' },
      { name: 'Robot Mops', cost: 4200, req: 8, decay: 0.38, cleanSpeed: 2.3, desc: 'Little robots mop overnight and between rushes. Gets dirty 62% slower.' },
    ],
  },
  {
    id: 'breakroom', name: 'Breakroom', group: 'Back office', levels: [
      { name: 'No Breakroom', cost: 0, req: 1, morale: 0, energy: 0, desc: 'Staff eat standing up.' },
      { name: 'Breakroom', cost: 800, req: 3, morale: 2, energy: 10, desc: '+2 morale a night, staff recover energy between jobs.' },
      { name: 'Staff Lounge', cost: 2300, req: 5, morale: 4, energy: 20, desc: '+4 morale a night, fast energy recovery.' },
      { name: 'Wellness Lounge', cost: 6000, req: 10, morale: 6, energy: 28, desc: '+6 morale a night, couches that people actually fight over.' },
    ],
  },
  {
    id: 'software', name: 'Inventory System', group: 'Back office', levels: [
      { name: 'Clipboard', cost: 0, req: 1, autoReorder: false, accuracy: 25, desc: 'Count stock by hand. Forecasts are rough (±25%), so order a healthy buffer.' },
      { name: 'Inventory Software', cost: 1050, req: 3, autoReorder: true, accuracy: 12, desc: 'Learns from your real sales (forecasts ±12%) and can order tomorrow\'s stock every night.' },
      { name: 'Smart Forecasting', cost: 2900, req: 5, autoReorder: true, accuracy: 6, desc: 'Weather-aware demand model (±6%). Smaller buffers, less waste, earlier run-out warnings.' },
    ],
  },
];
export const UPG: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

/** Which fridge model to draw for a storage level (several levels share a look). */
export const STORAGE_LOOK = [0, 0, 1, 2, 3];

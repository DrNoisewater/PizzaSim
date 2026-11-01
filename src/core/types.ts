// Game state types. Everything in GameState is plain JSON so saves are trivial.
import type { IngId, ItemId, SupplierId } from '../data/catalog';
import type { UpgradeId } from '../data/upgrades';
import type { CampaignId, LocationId, Role, ShiftId, TraitId, WeatherId } from '../data/world';
import type { P2 } from './layout';
import type { ReviewTopic } from '../data/text';

export type Difficulty = 'relaxed' | 'standard' | 'hard';
export type Phase = 'prep' | 'open' | 'closing' | 'report';

export interface Look {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  height: number;
}

export interface MoraleReason {
  label: string;
  v: number;
}

export interface Staff {
  id: number;
  name: string;
  role: Role;
  skill: number;
  xp: number;
  morale: number;
  energy: number;
  wage: number;
  traits: TraitId[];
  hiredDay: number;
  /** 'training' is kept only for old saves; training now happens in evening classes. */
  status: 'active' | 'training' | 'sick';
  /** Days left in current status (sick). */
  statusDays: number;
  task: Task | null;
  /** Minutes spent working (not idle) today. */
  busyMin: number;
  /** Minutes on the clock today. */
  shiftMin: number;
  tasksToday: number;
  bonusDay: number;
  look: Look;
  shift: ShiftId;
  /** Day off today (unpaid, rests and lifts morale). */
  offToday: boolean;
  /** Where they are standing, or will be when their current walk ends. */
  pos: P2;
  /** On the floor right now (clocked in and arrived). */
  onFloor: boolean;
  /** Preferred make-line station or till. */
  spot: number;
  /** Signed up for tonight's training class. */
  course: boolean;
  /** Why morale moved last night. */
  moraleWhy: MoraleReason[];
  /** Consecutive nights spent below the quitting line. */
  lowNights: number;
  /** Morale at the start of today, for the trend arrow. */
  moraleStart: number;
  /** Drops today (for performance reviews). */
  dropsToday?: number;
  /** Last 7 worked days: tasks done, minutes on the floor, busy minutes, drops. */
  record?: { day: number; tasks: number; min: number; busy: number; drops: number }[];
  /** Came in to help today outside their schedule (minutes of the day). Paid for those hours. */
  callIn?: { day: number; from: number; until: number; why: 'cover' | 'help' };
  /** A one-day lift in speed (a crew message, being fired up). */
  boost?: { day: number; mult: number; why: string };
  /** Hidden traits (Diamond in the Rough) have been spotted. */
  revealed?: boolean;
  /** Paid hours on each of the last 7 days (newest last), for overtime past 40 a week. */
  hoursLog?: number[];
  /** Drivers: minutes out on the road today (paid the road rate). */
  roadMin?: number;
  /** Drivers: tips collected today (paid by customers, not the store). */
  tipsToday?: number;
}

export interface Candidate {
  id: number;
  name: string;
  role: Role;
  skill: number;
  wage: number;
  traits: TraitId[];
  look: Look;
  /** Days before they take another job. */
  daysLeft?: number;
}

export type TaskKind = 'order' | 'prep' | 'deliver' | 'clean' | 'run' | 'bus' | 'walk';
export interface Task {
  kind: TaskKind;
  remaining: number;
  total: number;
  /** Minutes of walking at the start of the task (work happens after). */
  travel: number;
  /** Where the work happens. */
  to: P2;
  /** order: customer id. prep: order id. deliver: order ids. */
  customerId?: number;
  orderId?: number;
  itemIdx?: number;
  orderIds?: number[];
  /** Kitchen station index used by a prep task. */
  station?: number;
  /** Till used by an order task. */
  till?: number;
  /** Table being bused or served. */
  table?: number;
  /** deliver: minutes from start when the drop happens. */
  dropAt?: number;
  dropped?: boolean;
  /** Second leg of the walk (deliver: shelf then back door). */
  via?: P2;
  /** walk: a stroll back to their spot or to greet someone, dropped as soon as real work turns up. */
  idle?: boolean;
  /** walk: where it started, so an idle walk can be cut short mid-way. */
  from?: P2;
}

export type CustomerState = 'enter' | 'queue' | 'ordering' | 'toSeat' | 'waitFood' | 'eating' | 'pickup' | 'leave';
export type LeaveReason = 'line' | 'soldout' | 'refund' | 'done' | 'closed';
export interface Customer {
  id: number;
  kind: 'dine' | 'takeout';
  state: CustomerState;
  /** Minutes in the current state. */
  t: number;
  /** Minutes the current walk takes (enter, toSeat, pickup, leave). */
  dur: number;
  patience: number;
  /** When they joined the line (wait times count from here). */
  arrived: number;
  /** Where they are standing, or will be when the current walk ends. */
  pos: P2;
  /** Where the current walk started. */
  from: P2;
  /** Line position they walked to when entering. */
  slot: number;
  orderId?: number;
  seat?: number;
  waitSpot?: number;
  till?: number;
  eatFor?: number;
  critic?: boolean;
  mood: 'happy' | 'ok' | 'angry' | 'none';
  why?: LeaveReason;
  look: Look;
  /** Someone on the team has said hi. */
  greeted?: boolean;
  /** What this person notices (1 = average). Older saves have none: treated as average. */
  sens?: Sensitivity;
}

/** How much a customer cares about each thing. 1 is average; 0.4 barely notices, 1.6 is fussy. */
export interface Sensitivity {
  clean: number;
  wait: number;
  price: number;
  /** Short label for reviews ("Neat freak", "In a hurry"...). */
  label?: string;
}

export type ItemStage = 'queued' | 'prep' | 'ovenWait' | 'baking' | 'done';
export interface OrderItem {
  item: ItemId;
  stage: ItemStage;
  progress: number;
  quality: number;
  /** Made with ingredients on their last day. */
  stale?: boolean;
}

export interface Order {
  id: number;
  kind: 'dine' | 'takeout' | 'delivery';
  customerId?: number;
  name: string;
  items: OrderItem[];
  total: number;
  placed: number;
  expected: number;
  state: 'kitchen' | 'ready' | 'out' | 'done' | 'refunded';
  charm: number;
  critic?: boolean;
  /** When the kitchen finished it (food starts cooling). */
  readyAt?: number;
  /** Wait quoted at the till (minutes); customers who accepted it tolerate it. */
  quote?: number;
  /** What the customer cares about (copied from them; deliveries roll their own). */
  sens?: Sensitivity;
}

export interface Batch {
  qty: number;
  /** Last day (inclusive) the batch is usable. */
  exp: number;
}

export interface Incoming {
  ing: IngId;
  qty: number;
  /** Absolute minute it arrives; -1 = next morning. */
  at: number;
}

export interface DayStats {
  day: number;
  revenue: number;
  supplies: number;
  wages: number;
  rent: number;
  marketing: number;
  equipment: number;
  other: number;
  loan: number;
  foodCost: number;
  served: number;
  lost: number;
  soldOut: number;
  refunds: number;
  deliveries: number;
  satSum: number;
  satCount: number;
  waste: number;
  sold: Partial<Record<ItemId, number>>;
  ratingEnd: number;
  /** Saw the line was full and kept walking. */
  turnedAway: number;
  /** Gave up waiting in line. */
  walkouts: number;
  /** Pizzas that had to be remade, for any reason. */
  drops: number;
  /** Remakes split by reason. */
  remakes?: Partial<Record<RemakeReason, number>>;
  /** Times the manager had to jump on the line in a crunch. */
  mgrJumps?: number;
  /** Cleanliness summed over service minutes (for the manager's tips). */
  cleanSum?: number;
  cleanN?: number;
  /** Paid hours for people called in outside their schedule. */
  callInWages?: number;
  /** Extra half-pay for hours past 40 in a week. */
  overtime?: number;
  /** Drivers' tips today (paid by customers, not the store). */
  tips?: number;
  /** Mileage paid to drivers (also in other costs). */
  mileage?: number;
  /** Saved on driver pay: road hours at the road rate instead of the in-store rate. */
  roadSaved?: number;
  /** What the manager did today (call-offs covered, schedule fixes) for the receipt. */
  mgrNotes?: string[];
  /** Sum/count of minutes spent in line before ordering. */
  lineWaitSum: number;
  lineWaitN: number;
  /** Sum/count of minutes from order to food in hand. */
  serviceSum: number;
  serviceN: number;
  /** People who wanted to come in, per opening hour (10 AM = index 0). */
  demandByHour: number[];
  /** Orders handed over, per opening hour. */
  servedByHour: number[];
  /** Ingredient units used. */
  used: Partial<Record<IngId, number>>;
  /** Delivery fees collected (already inside revenue). */
  deliveryFees: number;
  expressOrders?: number;
  /** Model forecast of total ingredient units at opening (for Inventory Software's learning). */
  fcPred?: number;
  expressFees?: number;
}

export interface Review {
  day: number;
  name: string;
  stars: number;
  topic: ReviewTopic;
  text: string;
  critic?: boolean;
  /** What happened on their visit. */
  detail?: import('../data/text').ReviewDetail;
}

export interface Special {
  id: ItemId;
  window: import('../data/world').SpecialWindow;
  /** Percent off. */
  pct: number;
  /** Clearance deal on stock that expires tonight (ends at close). */
  clearance?: boolean;
}

export interface Store {
  id: number;
  locationId: LocationId;
  upgrades: Record<UpgradeId, number>;
  staff: Staff[];
  candidates: Candidate[];
  inventory: Record<IngId, Batch[]>;
  incoming: Incoming[];
  supplier: SupplierId;
  autoReorder: boolean;
  par: Partial<Record<IngId, number>>;
  menu: Record<ItemId, { on: boolean; price: number }>;
  customers: Customer[];
  orders: Order[];
  deliveryQueue: number[];
  cleanliness: number;
  rating: number;
  campaigns: { id: CampaignId; daysLeft: number }[];
  today: DayStats;
  history: DayStats[];
  reviews: Review[];
  ovenPenalty: number;
  /** Legacy (v1 saves); daily usage now lives in history[].used. */
  usage?: Partial<Record<IngId, number>>[];
  /** Self-order kiosks in use (index = kiosk). Old saves had a single `kiosk`. */
  kiosks: ({ customerId: number; remaining: number } | null)[];
  kiosk?: { customerId: number; remaining: number } | null;
  openedDay: number;
  /** Seats whose table still has dirty plates on it. */
  dirty: number[];
  /** Legacy single special (v2 saves). */
  special?: ItemId | null;
  /** Deals on the menu: discounted for part or all of the day. */
  specials: Special[];
  /** Auto-reorder: 'forecast' orders tomorrow's forecast, 'par' tops up to par levels. */
  reorderMode: 'forecast' | 'par';
  /** Logan Taylor is watching this store right now. */
  inspector?: InspectorWatch | null;
  /** Last inspection score (0-100) and the day it happened. */
  lastInspection?: { day: number; score: number; health: number; ops: number } | null;
  /** Extra stock to order on top of the forecast, in percent. null = recommended for your Inventory System. */
  orderBuffer: number | null;
  /** Day the morning truck was confirmed (so the open-for-business check only asks once). */
  truckDay: number;
  /** Forecast vs actual ingredient use, for Inventory Software's learning. */
  fcLog: { day: number; pred: number; used: number; limited: boolean }[];
  /** Consecutive days with an express order (the supplier's rush surcharge grows). */
  expressStreak: number;
  lastExpressDay: number;
  /** What a trained manager may order without asking. */
  mgrOrders: { truck: boolean; express: boolean; limit: number };
  /** Ingredients already warned about today. */
  warned: string[];
  /** Days left on a job ad (more and better applicants). */
  jobAd: number;
  /** Weekly schedule mode: shifts and days off are set each morning from the grid. */
  weekly: boolean;
  /** Rebuild the schedule from the forecast every night (days two or more out). */
  autoSchedule?: boolean;
  /** Delivery paused: no delivery orders come in (the bike stays parked). */
  deliveryOff?: boolean;
  /** Day delivery started, for a gentle first few days. */
  deliverySince?: number;
  /** Staff id -> shift (or 'off') for Mon..Sun. */
  schedule: Record<number, (import('../data/world').ShiftId | 'off')[]>;
  /** Crew-message streaks: consecutive nights of praise or of criticism. */
  crew?: { pos: number; neg: number; lastDay: number; sentDay: number; result?: string };
  /** Buzz: builds from great days and fun visits; milestones get the store featured. */
  buzz?: number;
  buzzLog?: { day: number; v: number; why: string }[];
  /** The Wall of Fame: features earned, and the lasting foot-traffic bump they add up to. */
  fame?: { id: string; day: number; outlet: string; headline: string }[];
  fameBonus?: number;
  /** Day the newest feature landed (for the receipt). */
  fameNew?: number;
  /** Crew celebration after a good run: when it was offered, last held, and how it went. */
  celebrate?: { offerDay: number; lastDay: number; doneDay?: number; result?: string };
  /** Team lift after a great inspection or review: faster work through this day. */
  teamBoost?: { until: number; mult: number; why: string };
  /** A crew message asking people to keep it clean: tidy sooner on this day. */
  cleanFocusDay?: number;
  /** Today's "Message the crew" for help: when it went out and pending replies. */
  helpMsg?: { day: number; at: number[]; replies: { id: number; at: number; yes: boolean; silent: boolean; text: string; done: boolean }[] };
}

export type EventKind =
  | 'inspection' | 'critic' | 'biggame' | 'festival' | 'cheese' | 'oven' | 'sick' | 'rival'
  | 'wholesale' | 'raise' | 'viral' | 'sale' | 'shortage' | 'concert' | 'heatwave' | 'logan' | 'fun';

/** Logan Taylor's visit in progress: counters at arrival plus running samples. */
export interface InspectorWatch {
  until: number;
  base: { served: number; walkouts: number; turnedAway: number; refunds: number; soldOut: number; drops: number; lineWaitSum: number; lineWaitN: number; serviceSum: number; serviceN: number };
  cleanSum: number;
  dirtySum: number;
  moraleSum: number;
  samples: number;
  /** Food left sitting on the pass, staff energy, people in line (time-weighted). */
  coldSum?: number;
  energySum?: number;
  lineSum?: number;
  /** Fridge over capacity at any point. */
  overfull?: boolean;
}

/** A pop-up the player reads before play continues. */
export interface Notice {
  kind: 'loganArrive' | 'loganReport' | 'criticArrive' | 'criticReport';
  /** Passed (shows the happy photo). */
  pass?: boolean;
  /** Rows of a breakdown: label, score 0-100. */
  scores?: [string, number][];
  tier?: string;
  storeId: number;
  title: string;
  body: string;
  health?: number;
  ops?: number;
  score?: number;
  tips?: string[];
  effect?: string;
}

/** An event announced ahead of time so the player can prepare. */
export interface Upcoming {
  kind: EventKind;
  /** First day it takes effect. */
  day: number;
  storeId: number | null;
  ing?: IngId;
  mult?: number;
  days?: number;
  label: string;
}

export interface ScheduledEvent {
  kind: EventKind;
  storeId: number;
  at: number;
  done: boolean;
  /** Which fun visit. */
  data?: string;
}

export interface Effect {
  kind: 'traffic' | 'dinner' | 'price' | 'upgradeSale';
  storeId: number | null;
  mult: number;
  ing?: IngId;
  daysLeft: number;
  label: string;
  /** price shortages: the day it started and how many days it lasts in all. */
  since?: number;
  total?: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
  detail: string;
}
export interface PendingChoice {
  kind: EventKind;
  storeId: number;
  title: string;
  body: string;
  options: ChoiceOption[];
  data?: Record<string, number | string>;
}

export interface Loan {
  principal: number;
  remaining: number;
  daily: number;
  daysLeft: number;
}

export interface DayReport {
  day: number;
  stores: { storeId: number; stats: DayStats; ratingStart: number }[];
  cashStart: number;
  cashEnd: number;
  levelStart: number;
  notes: string[];
  tomorrow: string[];
  /** Plain-language advice about the day's biggest problem. */
  advice?: string[];
}

export interface Stats {
  served: number;
  revenue: number;
  lost: number;
  bestDayRevenue: number;
  bestDayProfit: number;
  bestStreak?: number;
  ordersPlaced: number;
  upgradesBought: number;
  campaignsRun: number;
  trained: number;
  recipesUnlocked: number;
  hires: number;
  daysCompleted: number;
  deliveries: number;
}

export interface NewsItem {
  day: number;
  minute: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

export interface GameState {
  version: number;
  company: string;
  difficulty: Difficulty;
  rng: number;
  nextId: number;
  day: number;
  minute: number;
  phase: Phase;
  cash: number;
  dayStartCash: number;
  xp: number;
  level: number;
  stores: Store[];
  unlocked: ItemId[];
  loyalty: boolean;
  loan: Loan | null;
  goalIndex: number;
  goalsDone: string[];
  stats: Stats;
  weather: WeatherId;
  forecast: WeatherId;
  /** Weather outlook for the next 7 days (index 0 = tomorrow, same as forecast). */
  outlook?: WeatherId[];
  effects: Effect[];
  scheduled: ScheduledEvent[];
  choice: PendingChoice | null;
  tomorrowEvent: EventKind | null;
  tomorrowStore: number;
  market: Record<IngId, number>;
  report: DayReport | null;
  news: NewsItem[];
  negativeDays: number;
  gameOver: boolean;
  tutorial: boolean;
  /** Events announced in advance. */
  upcoming: Upcoming[];
  /** Effects that start tomorrow (word of a review spreads overnight). */
  pendingEffects?: Effect[];
  /** Pop-up waiting to be read (Logan's arrival and report card). */
  notice?: Notice | null;
  /** Day Logan last visited any store. */
  loganLast?: number;
  /** Day the critic last visited, and where he's going tomorrow (secret). */
  criticLast?: number;
  criticNext?: number | null;
  /** Store Logan will visit tomorrow (secret). */
  loganNext?: number | null;
  /** Day of the next fun visit, and the last few seen (no repeats too soon). */
  funNext?: number;
  funSeen?: string[];
}

export type RemakeReason = 'drop' | 'wrong' | 'burnt';


export interface SimEvent {
  type: 'sale' | 'served' | 'walkout' | 'levelup' | 'goal' | 'toast' | 'dayEnd' | 'review' | 'delivery' | 'ding' | 'error' | 'turnaway' | 'drop' | 'greet' | 'text';
  storeId?: number;
  amount?: number;
  text?: string;
  tone?: 'good' | 'bad' | 'info';
  customerId?: number;
  stars?: number;
  reason?: RemakeReason;
  /** text: who sent it ('out' = the manager's message to the crew). */
  from?: string;
  out?: boolean;
}

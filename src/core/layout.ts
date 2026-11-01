// The store floor plan, shared by the simulation (walking takes game time) and the
// renderer (people follow the same routes). Coordinates are meters: x to the right,
// z toward the street. The building interior spans x -7..7, z -5..5.1.
import { STORAGE_LOOK, UPG } from '../data/upgrades';
import type { Store } from './types';

export type P2 = [number, number];

/** Walking speed in meters per game minute. The renderer animates people at exactly this pace. */
export const WALK = 2.4;

// ---------------------------------------------------------------- fixed spots
export const DOOR_IN: P2 = [-0.6, 4.3];
export const DOOR_OUT: P2 = [-0.6, 6.3];
export const QUEUE: P2[] = [[-2.4, 0.35], [-2.4, 1.1], [-2.4, 1.85], [-2.4, 2.6], [-2.95, 3.25], [-3.65, 3.65], [-4.35, 4.0], [-5.05, 4.25], [-5.75, 4.4], [-6.3, 3.75]];
export const TILL_X = [-2.4, -0.8, 0.4];
export const ORDER_Z = -0.42;
export const TILL_STAFF_Z = -1.9;
export const KIOSK_SPOT: P2 = [1.25, -0.42];
/** Where customers stand at each self-order kiosk (the second sits between the first till and the pickup shelf). */
/** Self-order kiosks this store's register level has. */
export function kioskCount(st: Store): number {
  const lv = UPG.register.levels[st.upgrades.register];
  return Math.min(KIOSK_SPOTS.length, lv?.kiosks ?? (lv?.kiosk ? 1 : 0));
}
export const KIOSK_SPOTS: P2[] = [KIOSK_SPOT, [-3.35, -0.42]];
export const WAIT: P2[] = [[-5.6, -0.35], [-4.8, -0.3], [-6.3, 0.35], [-5.5, 0.45], [-4.7, 0.5], [-6.3, 1.25], [-5.5, 1.3], [-4.7, 1.35], [-6.0, 2.1], [-5.2, 2.15]];
/** Customer side of the pickup shelf (takeout). */
export const PICKUP_CUST: P2 = [-4.3, -0.42];
/** Staff side of the pickup shelf (drivers grab boxes here). */
export const PICKUP_STAFF: P2 = [-4.3, -1.95];
/** Where finished dine-in pizzas wait for a runner. */
export const PASS: P2 = [1.95, -2.0];
export const TABLES: P2[] = [[2.6, -0.15], [5.4, -0.15], [2.6, 1.4], [5.4, 1.4], [2.6, 2.95], [5.4, 2.95], [2.6, 4.35], [5.4, 4.35]];
export const STATIONS_X = [-3.9, -2.2, -0.5, 1.2];
export const STATION_Z = -2.75;
export const COOK_Z = -3.45;
export const COOK_IDLE: P2[] = [[-2.9, -4.25], [-0.3, -4.2], [2.3, -2.4], [-4.6, -1.95]];
export const BACK_DOOR: P2 = [6.55, -2.4];
export const BACK_OUT: P2 = [7.8, -2.4];
export const DRIVER_IDLE: P2[] = [[6.5, -2.0], [6.0, -2.15], [6.5, -2.6], [5.95, -2.6]];
export const MANAGER_POS: P2 = [4.8, -1.95];
export const FRONT_IDLE: P2[] = [[0.1, -2.0], [-1.6, -2.0], [2.3, -2.4]];
/** Floor spots front-of-house staff mop. */
export const CLEAN_POINTS: P2[] = [[1.6, 0.6], [4.0, 0.6], [4.0, 2.2], [1.8, 3.6], [4.0, 3.7], [-1.0, 2.5], [-4.5, 2.8], [6.3, 2.2], [-3.6, 0.9], [0.4, 1.2], [-5.6, 3.2], [0.6, 3.4]];
/** Sidewalk lane customers walk along before turning in. */
export const SIDEWALK_Z = 6.9;

export function seatPos(seat: number): { x: number; z: number; face: number; table: P2 } {
  const t = TABLES[Math.floor(seat / 2) % TABLES.length];
  const left = seat % 2 === 0;
  return { x: t[0] + (left ? -0.62 : 0.62), z: t[1], face: left ? Math.PI / 2 : -Math.PI / 2, table: t };
}
/** Where a runner or busser stands at a table. */
export function tableSide(table: number): P2 {
  const t = TABLES[table % TABLES.length];
  return [t[0], t[1] + 0.62];
}
export const tillCust = (i: number): P2 => [TILL_X[i % TILL_X.length], ORDER_Z];
export const tillStaff = (i: number): P2 => [TILL_X[i % TILL_X.length], TILL_STAFF_Z];
export const stationSpot = (i: number): P2 => [STATIONS_X[i % STATIONS_X.length], COOK_Z];

// ---------------------------------------------------------------- nav grid
const CELL = 0.2;
const X0 = -7.0, X1 = 7.0, Z0 = -4.9, Z1 = 5.0;
const NX = Math.round((X1 - X0) / CELL) + 1;
const NZ = Math.round((Z1 - Z0) / CELL) + 1;
const RADIUS = 0.2;

interface Rect { x0: number; x1: number; z0: number; z1: number }
const rect = (cx: number, cz: number, w: number, d: number): Rect => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });

/** Static furniture a store has; the grid depends only on these. */
export interface FloorConfig {
  tables: number;
  stations: number;
  oven: number;
  storage: number;
  kiosks: number;
  jukebox: boolean;
  breakroom: boolean;
  scrubber: boolean;
  dishwasher: boolean;
  desk: boolean;
}

export function floorConfig(st: Store, hasDesk: boolean): FloorConfig {
  const seats = UPG.dining.levels[st.upgrades.dining]?.seats ?? 4;
  return {
    tables: seats / 2,
    stations: UPG.prep.levels[st.upgrades.prep]?.stations ?? 1,
    oven: st.upgrades.oven,
    storage: STORAGE_LOOK[st.upgrades.storage] ?? 3,
    kiosks: kioskCount(st),
    jukebox: st.upgrades.decor >= 3,
    breakroom: st.upgrades.breakroom >= 1,
    scrubber: st.upgrades.cleaning >= 2,
    dishwasher: st.upgrades.cleaning >= 1,
    desk: hasDesk,
  };
}
const cfgKey = (c: FloorConfig) => Object.values(c).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)).join('');

function obstacles(c: FloorConfig, customer: boolean): Rect[] {
  const r: Rect[] = [];
  // service counter and the low divider; the gap between them is the staff gate
  r.push(rect(-1.6, -1.2, 6.5, 0.85));
  r.push(rect(3.8, -1.55, 2.6, 0.18)); // divider x 2.5..5.1
  // tables (chairs stay walkable so people can sit on them)
  for (let t = 0; t < c.tables; t++) r.push(rect(TABLES[t][0], TABLES[t][1], 0.9, 0.75));
  // corner plants
  r.push(rect(-6.5, 4.5, 0.5, 0.5), rect(6.6, 4.5, 0.5, 0.5), rect(6.6, -1.1, 0.5, 0.5), rect(-6.5, -1.35, 0.5, 0.5));
  if (c.jukebox) r.push(rect(1.25, 4.4, 0.85, 0.6));
  for (let k = 0; k < c.kiosks; k++) r.push(rect(KIOSK_SPOTS[k][0], -1.05, 0.65, 0.5));
  if (customer) {
    // customers never go behind the counter line
    r.push({ x0: -7.5, x1: 7.5, z0: -6, z1: -0.85 });
    return r;
  }
  // kitchen equipment
  for (let i = 0; i < c.stations; i++) r.push(rect(STATIONS_X[i], STATION_Z, 1.5, 0.85));
  if (c.oven <= 1) r.push(rect(-5.4, -4.35, 1.95, 1.25));
  else if (c.oven === 2) r.push(rect(-4.7, -4.4, 3.0, 1.2));
  else r.push(rect(-5.75, -3.75, 2.2, 2.0));
  if (c.storage === 0) r.push(rect(5.4, -4.65, 2.1, 0.6));
  else if (c.storage === 1) r.push(rect(5.55, -4.55, 2.5, 0.8));
  else r.push(rect(c.storage === 2 ? 5.55 : 5.4, -4.0, c.storage === 2 ? 2.6 : 3.4, 2.05));
  r.push(rect(-6.4, -2.05, 0.65, 1.05)); // dough crates
  r.push(rect(0.4, -4.6, 0.8, 0.7)); // drinks fridge
  if (c.dishwasher) r.push(rect(-1.6, -4.55, 1.6, 0.75));
  if (c.scrubber) r.push(rect(3.0, -4.5, 0.75, 0.95));
  if (c.breakroom) r.push(rect(2.5, -3.6, 1.0, 0.8));
  if (c.desk) r.push(rect(4.8, -2.5, 1.2, 0.6));
  return r;
}

interface Grid { free: Uint8Array; key: string }
const grids = new Map<string, Grid>();

function buildGrid(c: FloorConfig, customer: boolean): Grid {
  const key = (customer ? 'c' : 's') + cfgKey(c);
  const g = grids.get(key);
  if (g) return g;
  const free = new Uint8Array(NX * NZ).fill(1);
  const obs = obstacles(c, customer);
  for (let iz = 0; iz < NZ; iz++) {
    const z = Z0 + iz * CELL;
    for (let ix = 0; ix < NX; ix++) {
      const x = X0 + ix * CELL;
      for (const o of obs) {
        if (x > o.x0 - RADIUS && x < o.x1 + RADIUS && z > o.z0 - RADIUS && z < o.z1 + RADIUS) {
          free[iz * NX + ix] = 0;
          break;
        }
      }
    }
  }
  const out = { free, key };
  grids.set(key, out);
  if (grids.size > 64) grids.delete(grids.keys().next().value!);
  return out;
}

const cellOf = (p: P2): [number, number] => [Math.round((p[0] - X0) / CELL), Math.round((p[1] - Z0) / CELL)];
const inGrid = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < NX && iz < NZ;
const posOf = (ix: number, iz: number): P2 => [X0 + ix * CELL, Z0 + iz * CELL];

function nearestFree(g: Grid, ix: number, iz: number): [number, number] {
  if (inGrid(ix, iz) && g.free[iz * NX + ix]) return [ix, iz];
  for (let r = 1; r < 12; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = ix + dx, z = iz + dz;
      if (inGrid(x, z) && g.free[z * NX + x]) return [x, z];
    }
  }
  return [Math.max(0, Math.min(NX - 1, ix)), Math.max(0, Math.min(NZ - 1, iz))];
}

function lineFree(g: Grid, a: P2, b: P2): boolean {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.ceil(d / (CELL * 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const [ix, iz] = cellOf([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (!inGrid(ix, iz) || !g.free[iz * NX + ix]) return false;
  }
  return true;
}

// binary heap keyed by f
class Heap {
  k: number[] = [];
  v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

const gScore = new Float32Array(NX * NZ);
const came = new Int32Array(NX * NZ);
const stamp = new Int32Array(NX * NZ);
let curStamp = 0;

function astar(g: Grid, a: P2, b: P2): P2[] {
  const [sx, sz] = nearestFree(g, ...cellOf(a));
  const [tx, tz] = nearestFree(g, ...cellOf(b));
  const start = sz * NX + sx, goal = tz * NX + tx;
  if (start === goal) return [b];
  curStamp++;
  const h = (i: number) => {
    const dx = Math.abs((i % NX) - tx), dz = Math.abs(Math.floor(i / NX) - tz);
    return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * CELL;
  };
  const open = new Heap();
  stamp[start] = curStamp;
  gScore[start] = 0;
  came[start] = -1;
  open.push(h(start), start);
  let found = false;
  let guard = 0;
  while (open.size && guard++ < NX * NZ * 2) {
    const cur = open.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % NX, cz = Math.floor(cur / NX);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!inGrid(nx, nz)) continue;
      const ni = nz * NX + nx;
      if (!g.free[ni]) continue;
      // no corner cutting
      if (dx && dz && (!g.free[cz * NX + nx] || !g.free[nz * NX + cx])) continue;
      const cost = gScore[cur] + (dx && dz ? Math.SQRT2 : 1) * CELL;
      if (stamp[ni] === curStamp && cost >= gScore[ni]) continue;
      stamp[ni] = curStamp;
      gScore[ni] = cost;
      came[ni] = cur;
      open.push(cost + h(ni), ni);
    }
  }
  // no way through: never cut across the counter or a wall, only go straight if the line is clear
  if (!found) return lineFree(g, a, b) ? [b] : [a];
  const cells: P2[] = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(posOf(i % NX, Math.floor(i / NX)));
  cells.reverse();
  // the real start and end points, unless they sit inside furniture: then stop at the nearest open
  // cell rather than stepping through (that last little leg was where people clipped the counter)
  const last = cells[cells.length - 1];
  if (lineFree(g, cells[0], a) || Math.hypot(cells[0][0] - a[0], cells[0][1] - a[1]) < 0.3) cells[0] = a;
  const endOk = lineFree(g, last, b) || Math.hypot(last[0] - b[0], last[1] - b[1]) < 0.3;
  if (endOk) cells[cells.length - 1] = b;
  b = cells[cells.length - 1];
  a = cells[0];
  // string pulling: keep only the corners we can't see past
  const out: P2[] = [];
  let anchor = a;
  for (let i = 1; i < cells.length; i++) {
    if (!lineFree(g, anchor, cells[i])) {
      anchor = cells[i - 1];
      out.push(anchor);
    }
  }
  out.push(b);
  return out;
}

/** Is this point free of furniture? */
export function isWalkable(c: FloorConfig, p: P2, customer: boolean): boolean {
  const g = buildGrid(c, customer);
  const [ix, iz] = cellOf(p);
  return inGrid(ix, iz) && !!g.free[iz * NX + ix];
}

/** Nearest walkable point (targets inside furniture get nudged out). */
export function snap(c: FloorConfig, p: P2, customer: boolean): P2 {
  if (!inside(p)) return p;
  const g = buildGrid(c, customer);
  const [ix, iz] = cellOf(p);
  if (inGrid(ix, iz) && g.free[iz * NX + ix]) return p;
  const [fx, fz] = nearestFree(g, ix, iz);
  return posOf(fx, fz);
}

const routeCache = new Map<string, P2[]>();
const rk = (p: P2) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;

/** Interior route from a to b (both inside the building). */
export function navRoute(c: FloorConfig, a: P2, b: P2, customer: boolean): P2[] {
  const g = buildGrid(c, customer);
  const key = g.key + '|' + rk(a) + '|' + rk(b);
  const hit = routeCache.get(key);
  if (hit) return hit;
  const r = lineFree(g, a, b) ? [b] : astar(g, a, b);
  routeCache.set(key, r);
  if (routeCache.size > 4000) routeCache.delete(routeCache.keys().next().value!);
  return r;
}

const inside = (p: P2) => p[1] < 5.0 && p[0] > -7.2 && p[0] < 7.2;

/**
 * Full route for a person, including the trip through the front door (customers) or
 * the back door (staff) when one end is outside. Returns waypoints after `a`.
 */
export function route(c: FloorConfig, a: P2, b: P2, customer: boolean): P2[] {
  const ai = inside(a), bi = inside(b);
  if (ai && bi) return navRoute(c, a, b, customer);
  if (customer) {
    if (!ai && bi) return [DOOR_OUT, DOOR_IN, ...navRoute(c, DOOR_IN, b, true)];
    if (ai && !bi) return [...navRoute(c, a, DOOR_IN, true), DOOR_OUT, b];
    return [b];
  }
  if (!ai && bi) return [BACK_DOOR, ...navRoute(c, BACK_DOOR, b, false)];
  if (ai && !bi) return [...navRoute(c, a, BACK_DOOR, false), BACK_OUT, b];
  return [b];
}

export function routeLength(a: P2, pts: P2[]): number {
  let d = 0, p = a;
  for (const q of pts) {
    d += Math.hypot(q[0] - p[0], q[1] - p[1]);
    p = q;
  }
  return d;
}

/** Walking time in game minutes. */
export function walkMinutes(c: FloorConfig, a: P2, b: P2, customer: boolean): number {
  return routeLength(a, route(c, a, b, customer)) / WALK;
}

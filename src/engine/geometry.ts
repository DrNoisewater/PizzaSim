// Geometry builders. Everything is non-indexed triangles with per-vertex
// position, normal, uv and color, which keeps the low-poly faceted look cheap.
import { m4, type M4, type V3, hex } from './math';

export class Geometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  count: number;
  min: V3 = [0, 0, 0];
  max: V3 = [0, 0, 0];
  /** GPU handles, owned by the renderer. */
  gpu: unknown = null;
  constructor(p: number[], n: number[], u: number[], c: number[]) {
    this.positions = new Float32Array(p);
    this.normals = new Float32Array(n);
    this.uvs = new Float32Array(u);
    this.colors = new Float32Array(c);
    this.count = p.length / 3;
    this.computeBounds();
  }
  computeBounds() {
    const p = this.positions;
    const mn: V3 = [Infinity, Infinity, Infinity];
    const mx: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < mn[k]) mn[k] = p[i + k];
        if (p[i + k] > mx[k]) mx[k] = p[i + k];
      }
    }
    if (!p.length) {
      this.min = [0, 0, 0];
      this.max = [0, 0, 0];
    } else {
      this.min = mn;
      this.max = mx;
    }
  }
}

/** Accumulates triangles. */
class Builder {
  p: number[] = [];
  n: number[] = [];
  u: number[] = [];
  c: number[] = [];
  color: V3 = [1, 1, 1];
  vert(pos: V3, nor: V3, uv: [number, number]) {
    this.p.push(pos[0], pos[1], pos[2]);
    this.n.push(nor[0], nor[1], nor[2]);
    this.u.push(uv[0], uv[1]);
    this.c.push(this.color[0], this.color[1], this.color[2]);
  }
  /** Flat triangle (counter-clockwise front). */
  tri(a: V3, b: V3, c: V3, ua: [number, number] = [0, 0], ub: [number, number] = [1, 0], uc: [number, number] = [1, 1], normals?: [V3, V3, V3]) {
    let na: V3, nb: V3, nc: V3;
    if (normals) {
      [na, nb, nc] = normals;
    } else {
      const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      na = nb = nc = [nx / l, ny / l, nz / l];
    }
    this.vert(a, na, ua);
    this.vert(b, nb, ub);
    this.vert(c, nc, uc);
  }
  quad(a: V3, b: V3, c: V3, d: V3, uv: [number, number, number, number] = [0, 0, 1, 1]) {
    const [u0, v0, u1, v1] = uv;
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1]);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1]);
  }
  build() {
    return new Geometry(this.p, this.n, this.u, this.c);
  }
}

export interface BoxOpts {
  /** UV repeat in world units per texture tile (0 = stretch 0..1 per face). */
  tile?: number;
}

export function box(w: number, h: number, d: number, opts: BoxOpts = {}): Geometry {
  const b = new Builder();
  const x = w / 2, y = h / 2, z = d / 2;
  const t = opts.tile || 0;
  const uvw = (a: number, bb: number): [number, number, number, number] => (t ? [0, 0, a / t, bb / t] : [0, 0, 1, 1]);
  // +z (front)
  b.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], uvw(w, h));
  // -z (back)
  b.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], uvw(w, h));
  // +x
  b.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], uvw(d, h));
  // -x
  b.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], uvw(d, h));
  // +y
  b.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], uvw(w, d));
  // -y
  b.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], uvw(w, d));
  return b.build();
}

export function plane(w: number, d: number, tile = 0): Geometry {
  const b = new Builder();
  const x = w / 2, z = d / 2;
  const uv: [number, number, number, number] = tile ? [0, 0, w / tile, d / tile] : [0, 0, 1, 1];
  b.quad([-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z], uv);
  return b.build();
}

/** Vertical plane facing +z (for signs, art, menu boards). */
export function panel(w: number, h: number): Geometry {
  const b = new Builder();
  const x = w / 2, y = h / 2;
  b.quad([-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [0, 0, 1, 1]);
  return b.build();
}

/** Vertical plane facing +z with explicit UV repeats. */
export function panelUV(w: number, h: number, u: number, v: number): Geometry {
  const b = new Builder();
  const x = w / 2, y = h / 2;
  b.quad([-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [0, 0, u, v]);
  return b.build();
}

export interface CylOpts {
  smooth?: boolean;
  thetaStart?: number;
  thetaLength?: number;
  capTop?: boolean;
  capBottom?: boolean;
}

/** Cylinder / cone / wedge centered on origin, axis +y. */
export function cylinder(rt: number, rb: number, h: number, seg = 12, o: CylOpts = {}): Geometry {
  const b = new Builder();
  const t0 = o.thetaStart ?? 0;
  const tl = o.thetaLength ?? Math.PI * 2;
  const full = Math.abs(tl - Math.PI * 2) < 1e-6;
  const y0 = -h / 2, y1 = h / 2;
  const slope = (rb - rt) / h;
  const pt = (r: number, a: number, y: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];
  for (let i = 0; i < seg; i++) {
    const a0 = t0 + (tl * i) / seg;
    const a1 = t0 + (tl * (i + 1)) / seg;
    const p00 = pt(rb, a0, y0), p10 = pt(rb, a1, y0), p11 = pt(rt, a1, y1), p01 = pt(rt, a0, y1);
    const u0 = i / seg, u1 = (i + 1) / seg;
    const n0 = normSide(a0, slope), n1 = normSide(a1, slope);
    const nm = normSide((a0 + a1) / 2, slope);
    const N = (a: V3, b2: V3, c: V3): [V3, V3, V3] | undefined => (o.smooth ? [a, b2, c] : undefined);
    if (rt === 0) {
      // cone: one triangle to the apex
      b.tri(p00, p10, p01, [u0, 0], [u1, 0], [(u0 + u1) / 2, 1], N(n0, n1, nm));
    } else if (rb === 0) {
      b.tri(p00, p11, p01, [(u0 + u1) / 2, 0], [u1, 1], [u0, 1], N(nm, n1, n0));
    } else {
      b.tri(p00, p10, p11, [u0, 0], [u1, 0], [u1, 1], N(n0, n1, n1));
      b.tri(p00, p11, p01, [u0, 0], [u1, 1], [u0, 1], N(n0, n1, n0));
    }
    if (o.capTop !== false && rt > 0) {
      b.tri([0, y1, 0], p01, p11, [0.5, 0.5], [0.5 + Math.sin(a0) / 2, 0.5 + Math.cos(a0) / 2], [0.5 + Math.sin(a1) / 2, 0.5 + Math.cos(a1) / 2]);
    }
    if (o.capBottom !== false && rb > 0) {
      b.tri([0, y0, 0], p10, p00, [0.5, 0.5], [0.5 + Math.sin(a1) / 2, 0.5 + Math.cos(a1) / 2], [0.5 + Math.sin(a0) / 2, 0.5 + Math.cos(a0) / 2]);
    }
  }
  if (!full) {
    // close the wedge
    const a0 = t0, a1 = t0 + tl;
    b.quad(pt(rb, a0, y0), pt(rt, a0, y1), [0, y1, 0], [0, y0, 0]);
    b.quad([0, y0, 0], [0, y1, 0], pt(rt, a1, y1), pt(rb, a1, y0));
  }
  return b.build();
}
function normSide(a: number, slope: number): V3 {
  const l = Math.hypot(1, slope);
  return [Math.sin(a) / l, slope / l, Math.cos(a) / l];
}

/** UV sphere. thetaLength < PI gives a dome (top part). */
export function sphere(r: number, ws = 12, hs = 8, smoothN = true, thetaLength = Math.PI): Geometry {
  const b = new Builder();
  const P = (i: number, j: number): V3 => {
    const th = (j / hs) * thetaLength;
    const ph = (i / ws) * Math.PI * 2;
    return [Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r, Math.sin(th) * Math.cos(ph) * r];
  };
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const a = P(i, j), bb = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const uv = (ii: number, jj: number): [number, number] => [ii / ws, 1 - jj / hs];
      if (smoothN) {
        const n = (p: V3): V3 => [p[0] / r, p[1] / r, p[2] / r];
        if (j !== 0) b.tri(a, d, c, uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), [n(a), n(d), n(c)]);
        b.tri(a, c, bb, uv(i, j), uv(i + 1, j + 1), uv(i + 1, j), [n(a), n(c), n(bb)]);
        if (j === 0) b.tri(a, d, c, uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), [n(a), n(d), n(c)]);
      } else {
        if (j !== 0) b.tri(a, d, c);
        b.tri(a, c, bb);
        if (j === 0) b.tri(a, d, c);
      }
    }
  }
  return b.build();
}

export interface Part {
  geo: Geometry;
  pos?: V3;
  rot?: V3;
  scale?: V3;
  color?: string | V3;
}

/** Bake several primitives (with transforms and vertex colors) into one geometry. */
export function merge(parts: Part[]): Geometry {
  const p: number[] = [], n: number[] = [], u: number[] = [], c: number[] = [];
  const m = m4.create();
  const nm = new Float32Array(9);
  for (const part of parts) {
    m4.compose(m, part.pos ?? [0, 0, 0], part.rot ?? [0, 0, 0], part.scale ?? [1, 1, 1]);
    m4.normalMat(nm, m);
    const col: V3 = part.color ? (typeof part.color === 'string' ? hex(part.color) : part.color) : [1, 1, 1];
    const g = part.geo;
    for (let i = 0; i < g.count; i++) {
      const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
      p.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      const nx = g.normals[i * 3], ny = g.normals[i * 3 + 1], nz = g.normals[i * 3 + 2];
      let ox = nm[0] * nx + nm[3] * ny + nm[6] * nz;
      let oy = nm[1] * nx + nm[4] * ny + nm[7] * nz;
      let oz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      ox /= l; oy /= l; oz /= l;
      n.push(ox, oy, oz);
      u.push(g.uvs[i * 2], g.uvs[i * 2 + 1]);
      c.push(g.colors[i * 3] * col[0], g.colors[i * 3 + 1] * col[1], g.colors[i * 3 + 2] * col[2]);
    }
  }
  return new Geometry(p, n, u, c);
}

// Shared unit primitives, cached so repeated props don't allocate.
const cache = new Map<string, Geometry>();
export function cached(key: string, make: () => Geometry): Geometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}
export type { M4 };

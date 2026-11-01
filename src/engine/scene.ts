// Scene graph: nodes, meshes, sprites, materials, textures and the camera.
import { m4, type M4, type V3, hex } from './math';
import type { Geometry } from './geometry';

let nextNodeId = 1;

export class Node {
  id = nextNodeId++;
  name = '';
  position: V3 = [0, 0, 0];
  rotation: V3 = [0, 0, 0];
  scale: V3 = [1, 1, 1];
  visible = true;
  children: Node[] = [];
  parent: Node | null = null;
  local: M4 = m4.create();
  world: M4 = m4.create();
  /** Free-form tags, e.g. { pick: 'oven' } for click targets. */
  userData: Record<string, unknown> = {};

  add(...nodes: Node[]): this {
    for (const n of nodes) {
      if (n.parent) n.parent.remove(n);
      n.parent = this;
      this.children.push(n);
    }
    return this;
  }
  remove(n: Node) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parent = null;
  }
  clear() {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
  }
  at(x: number, y: number, z: number): this {
    this.position = [x, y, z];
    return this;
  }
  rotY(a: number): this {
    this.rotation = [this.rotation[0], a, this.rotation[2]];
    return this;
  }
  setScale(s: number | V3): this {
    this.scale = typeof s === 'number' ? [s, s, s] : s;
    return this;
  }
  updateWorld(parentWorld: M4 | null) {
    m4.compose(this.local, this.position, this.rotation, this.scale);
    if (parentWorld) m4.mul(this.world, parentWorld, this.local);
    else this.world.set(this.local);
    for (const c of this.children) c.updateWorld(this.world);
  }
  traverse(fn: (n: Node) => void) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
  /** Visible in the hierarchy (all ancestors visible). */
  isShown(): boolean {
    let n: Node | null = this;
    while (n) {
      if (!n.visible) return false;
      n = n.parent;
    }
    return true;
  }
}

export class Texture {
  source: TexImageSource;
  repeat = true;
  needsUpdate = true;
  nearest = false;
  gpu: WebGLTexture | null = null;
  constructor(source: TexImageSource, opts: { repeat?: boolean; nearest?: boolean } = {}) {
    this.source = source;
    if (opts.repeat !== undefined) this.repeat = opts.repeat;
    if (opts.nearest) this.nearest = true;
  }
}

export interface MaterialOpts {
  color?: string | V3;
  emissive?: string | V3;
  emissiveIntensity?: number;
  map?: Texture | null;
  opacity?: number;
  unlit?: boolean;
  doubleSided?: boolean;
  /** How much of the final color feeds the bloom glow (0..1+). */
  glow?: number;
}

export class Material {
  color: V3;
  emissive: V3;
  emissiveIntensity: number;
  map: Texture | null;
  opacity: number;
  unlit: boolean;
  /** Highlight tint (hover). */
  highlight = 0;
  glow: number;
  constructor(o: MaterialOpts = {}) {
    this.color = toV3(o.color ?? '#ffffff');
    this.emissive = toV3(o.emissive ?? '#000000');
    this.emissiveIntensity = o.emissiveIntensity ?? 1;
    this.map = o.map ?? null;
    this.opacity = o.opacity ?? 1;
    this.unlit = !!o.unlit;
    this.glow = o.glow ?? 0;
  }
  get transparent() {
    return this.opacity < 0.999;
  }
  setColor(c: string | V3) {
    this.color = toV3(c);
    return this;
  }
}

function toV3(c: string | V3): V3 {
  return typeof c === 'string' ? hex(c) : c;
}

export class Mesh extends Node {
  geometry: Geometry;
  material: Material;
  castShadow = true;
  receiveShadow = true;
  constructor(geometry: Geometry, material: Material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

/** Camera-facing quad textured with a canvas (labels, floating text, icons). */
export class Sprite extends Node {
  texture: Texture;
  width: number;
  height: number;
  opacity = 1;
  tint: V3 = [1, 1, 1];
  glow = 0;
  spin = 0;
  constructor(texture: Texture, width: number, height: number) {
    super();
    this.texture = texture;
    this.width = width;
    this.height = height;
  }
}

export class Camera {
  fov = (36 * Math.PI) / 180;
  aspect = 1;
  near = 0.5;
  far = 260;
  eye: V3 = [20, 18, 20];
  target: V3 = [0, 0, 0];
  view: M4 = m4.create();
  proj: M4 = m4.create();
  viewProj: M4 = m4.create();
  invViewProj: M4 = m4.create();
  update() {
    m4.lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    m4.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    m4.mul(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
  }
  /** World-space ray through normalized device coords. */
  ray(ndcX: number, ndcY: number): { origin: V3; dir: V3 } {
    const a = m4.transformPoint(this.invViewProj, [ndcX, ndcY, -1]);
    const b = m4.transformPoint(this.invViewProj, [ndcX, ndcY, 1]);
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { origin: a, dir: [d[0] / l, d[1] / l, d[2] / l] };
  }
  /** Project a world point to CSS pixel coordinates. */
  project(p: V3, w: number, h: number): { x: number; y: number; behind: boolean } {
    const v = this.viewProj;
    const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
    const y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
    const ww = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    return { x: ((x / ww) * 0.5 + 0.5) * w, y: (1 - ((y / ww) * 0.5 + 0.5)) * h, behind: ww <= 0 };
  }
}

export interface PointLight {
  pos: V3;
  color: V3;
  range: number;
}

export interface Environment {
  clear: V3;
  sky: V3;
  ground: V3;
  sunDir: V3;
  sunColor: V3;
  fog: V3;
  fogNear: number;
  fogFar: number;
  points: PointLight[];
  shadows: boolean;
  shadowCenter: V3;
  shadowRadius: number;
}

/** Ray vs. world-space bounding boxes of pickable meshes. */
export function pick(root: Node, cam: Camera, ndcX: number, ndcY: number): Node | null {
  const { origin, dir } = cam.ray(ndcX, ndcY);
  let best: Node | null = null;
  let bestT = Infinity;
  const corners: V3[] = new Array(8);
  root.traverse((n) => {
    if (!(n instanceof Mesh) || !n.isShown()) return;
    let owner: Node | null = n;
    while (owner && owner.userData.pick === undefined) owner = owner.parent;
    if (!owner) return;
    const g = n.geometry;
    const mn = g.min, mx = g.max;
    let k = 0;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        for (let l = 0; l < 2; l++) corners[k++] = m4.transformPoint(n.world, [i ? mx[0] : mn[0], j ? mx[1] : mn[1], l ? mx[2] : mn[2]]);
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) for (let a = 0; a < 3; a++) {
      if (c[a] < lo[a]) lo[a] = c[a];
      if (c[a] > hi[a]) hi[a] = c[a];
    }
    let t0 = -Infinity, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dir[a]) < 1e-9) {
        if (origin[a] < lo[a] || origin[a] > hi[a]) return;
      } else {
        let ta = (lo[a] - origin[a]) / dir[a];
        let tb = (hi[a] - origin[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return;
      }
    }
    if (t1 < 0) return;
    const t = t0 > 0 ? t0 : t1;
    if (t < bestT) {
      bestT = t;
      best = owner;
    }
  });
  return best;
}

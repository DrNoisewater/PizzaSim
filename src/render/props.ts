// Low-poly prop builders. Static props are baked into one vertex-colored mesh each.
import { box, cached, cylinder, merge, panel, plane, sphere, type Part, Geometry } from '../engine/geometry';
import { Material, Mesh, Node, type Texture } from '../engine/scene';
import type { V3 } from '../engine/math';

export const WHITE = new Material({ color: '#ffffff' });
export type WHITE_PARTS = Part[];

// shared unit primitives
const BOX = () => cached('box1', () => box(1, 1, 1));
const CYL = (seg = 12) => cached('cyl' + seg, () => cylinder(0.5, 0.5, 1, seg));
const CYLS = (seg = 14) => cached('cyls' + seg, () => cylinder(0.5, 0.5, 1, seg, { smooth: true }));
const CONE = (seg = 8) => cached('cone' + seg, () => cylinder(0, 0.5, 1, seg));
const SPH = () => cached('sph', () => sphere(0.5, 12, 8, true));
const LOWSPH = () => cached('lowsph', () => sphere(0.5, 7, 5, false));

/** Box part with its base at y (helper uses center positions). */
export function bx(x: number, y: number, z: number, w: number, h: number, d: number, color: string, rot?: V3): Part {
  return { geo: BOX(), pos: [x, y + h / 2, z], scale: [w, h, d], color, rot };
}
export function cy(x: number, y: number, z: number, r: number, h: number, color: string, seg = 12, smooth = false): Part {
  return { geo: smooth ? CYLS(seg) : CYL(seg), pos: [x, y + h / 2, z], scale: [r * 2, h, r * 2], color };
}
function cone(x: number, y: number, z: number, r: number, h: number, color: string, seg = 8): Part {
  return { geo: CONE(seg), pos: [x, y + h / 2, z], scale: [r * 2, h, r * 2], color };
}
function sp(x: number, y: number, z: number, r: number, color: string, low = false): Part {
  return { geo: low ? LOWSPH() : SPH(), pos: [x, y, z], scale: [r * 2, r * 2, r * 2], color };
}

export function meshOf(parts: Part[], mat: Material = WHITE, pick?: string): Mesh {
  const m = new Mesh(merge(parts), mat);
  if (pick) m.userData.pick = pick;
  return m;
}

export function texturedBox(w: number, h: number, d: number, tex: Texture, tile = 2, color = '#ffffff'): Mesh {
  return new Mesh(box(w, h, d, { tile }), new Material({ color, map: tex }));
}
export function texturedPlane(w: number, d: number, tex: Texture, tile = 2, color = '#ffffff'): Mesh {
  const m = new Mesh(plane(w, d, tile), new Material({ color, map: tex }));
  m.castShadow = false;
  return m;
}
export function texturedPanel(w: number, h: number, tex: Texture, opts: { unlit?: boolean; emissive?: string } = {}): Mesh {
  const m = new Mesh(panel(w, h), new Material({ map: tex, unlit: opts.unlit, emissive: opts.emissive }));
  m.castShadow = false;
  return m;
}

// ------------------------------------------------------------------ furniture

export function table(top = '#f4efe3', cloth = true): Part[] {
  const p: Part[] = [
    bx(0, 0.72, 0, 0.9, 0.05, 0.75, top),
    cy(0, 0, 0, 0.05, 0.72, '#2f2b28', 6),
    cy(0, 0, 0, 0.26, 0.04, '#2f2b28', 10),
  ];
  if (cloth) {
    // red & white check suggested with a few stripes
    p.push(bx(0, 0.765, 0, 0.92, 0.01, 0.77, '#f6f1e6'));
    for (let i = -2; i <= 2; i++) p.push(bx(i * 0.18, 0.772, 0, 0.07, 0.006, 0.77, '#c8352a'));
    for (let i = -2; i <= 2; i++) p.push(bx(0, 0.774, i * 0.15, 0.92, 0.006, 0.06, '#c8352a'));
  }
  return p;
}
export function chair(x: number, z: number, face: number, color = '#7b4a2a'): Part[] {
  const s = Math.sin(face), c = Math.cos(face);
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, z - dx * s + dz * c];
  const parts: Part[] = [];
  const [sx, sz] = at(0, 0);
  parts.push(bx(sx, 0.44, sz, 0.42, 0.06, 0.42, color, [0, face, 0]));
  const [bx2, bz2] = at(0, -0.19);
  parts.push(bx(bx2, 0.5, bz2, 0.42, 0.45, 0.05, color, [0, face, 0]));
  for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    const [lx, lz] = at(dx, dz);
    parts.push(bx(lx, 0, lz, 0.04, 0.44, 0.04, '#3a2a20'));
  }
  return parts;
}
export function booth(x: number, z: number, face: number, color: string): Part[] {
  return [
    bx(x, 0, z, 0.55, 0.45, 1.0, '#5a3a22', [0, face, 0]),
    bx(x, 0.45, z, 0.5, 0.08, 0.96, color, [0, face, 0]),
    bx(x - Math.cos(face) * 0.22, 0.45, z + Math.sin(face) * 0.22, 0.1, 0.6, 1.0, color, [0, face, 0]),
  ];
}

export function plant(x: number, z: number, big = false): Part[] {
  const s = big ? 1.4 : 1;
  return [
    cy(x, 0, z, 0.22 * s, 0.42 * s, '#b4643c', 8),
    cy(x, 0.42 * s, z, 0.24 * s, 0.05 * s, '#8a4a2a', 8),
    sp(x, 0.75 * s, z, 0.36 * s, '#3f8a46', true),
    sp(x + 0.15 * s, 0.98 * s, z + 0.05 * s, 0.24 * s, '#4f9f52', true),
    sp(x - 0.12 * s, 1.0 * s, z - 0.1 * s, 0.22 * s, '#357a3d', true),
  ];
}

export function counter(w: number, top: string, front: string): Part[] {
  return [
    bx(0, 0, 0, w, 1.0, 0.7, front),
    bx(0, 1.0, 0, w + 0.1, 0.06, 0.8, top),
    bx(0, 0, 0.36, w, 0.12, 0.02, '#2b2724'),
  ];
}

export function register(level: number): Part[] {
  if (level === 0) return [bx(0, 0, 0, 0.42, 0.18, 0.36, '#3a3a3a'), bx(0, 0.18, -0.05, 0.38, 0.06, 0.2, '#c99a62')];
  return [
    bx(0, 0, 0, 0.36, 0.06, 0.3, '#2b2b2e'),
    bx(0, 0.06, 0, 0.06, 0.25, 0.06, '#2b2b2e'),
    bx(0, 0.28, 0.02, 0.4, 0.28, 0.04, '#1a1a1d', [-0.3, 0, 0]),
    bx(0, 0.3, 0.045, 0.34, 0.22, 0.01, level >= 2 ? '#7fd1ff' : '#8fd6a1', [-0.3, 0, 0]),
  ];
}
export function kiosk(): Part[] {
  return [
    bx(0, 0, 0, 0.5, 0.06, 0.45, '#2b2b2e'),
    bx(0, 0.06, 0, 0.16, 1.0, 0.16, '#d8402b'),
    bx(0, 1.0, 0, 0.62, 0.8, 0.08, '#1a1a1d', [-0.15, 0, 0]),
    bx(0, 1.05, 0.05, 0.52, 0.66, 0.01, '#9ad7ff', [-0.15, 0, 0]),
  ];
}

export function prepTable(): Part[] {
  return [
    bx(0, 0, 0, 1.45, 0.88, 0.8, '#b9bdc2'),
    bx(0, 0.88, 0, 1.5, 0.05, 0.85, '#d9dde1'),
    // topping rail
    bx(0, 0.93, -0.3, 1.4, 0.12, 0.22, '#8f969d'),
    ...[-0.55, -0.33, -0.11, 0.11, 0.33, 0.55].map((x, i) => bx(x, 0.98, -0.3, 0.18, 0.08, 0.16, ['#c8352a', '#f6efd2', '#b53a2a', '#3e8a3a', '#b9a58a', '#f2d34b'][i])),
    bx(0, 0.3, 0.41, 1.3, 0.04, 0.02, '#7a8188'),
  ];
}

export function oven(level: number): { body: Mesh; glow: Mesh; fire?: Mesh } {
  const glowMat = new Material({ color: '#2b1308', emissive: '#ff7a2a', emissiveIntensity: 0.4 });
  if (level === 0 || level === 1) {
    const stacks = level === 0 ? 1 : 2;
    const parts: Part[] = [bx(0, 0, 0, 1.9, 0.5, 1.2, '#55595e')];
    const glowParts: Part[] = [];
    for (let i = 0; i < stacks; i++) {
      const y = 0.5 + i * 0.72;
      parts.push(bx(0, y, 0, 1.9, 0.7, 1.2, '#9aa1a8'));
      parts.push(bx(0, y + 0.08, 0.61, 1.6, 0.5, 0.03, '#3a3d41'));
      parts.push(bx(0, y + 0.5, 0.64, 1.2, 0.05, 0.06, '#d9dde1'));
      glowParts.push(bx(0, y + 0.18, 0.635, 1.1, 0.22, 0.01, '#ffffff'));
    }
    parts.push(bx(0.75, 0.5 + stacks * 0.72, -0.3, 0.16, 0.8, 0.16, '#6b7076'));
    return { body: meshOf(parts, WHITE, 'oven'), glow: meshOf(glowParts, glowMat, 'oven') };
  }
  if (level === 2) {
    const parts: Part[] = [
      bx(0, 0, 0, 0.2, 0.85, 1.0, '#55595e'),
      bx(-1.3, 0, 0, 0.2, 0.85, 1.0, '#55595e'),
      bx(1.3, 0, 0, 0.2, 0.85, 1.0, '#55595e'),
      bx(0, 0.85, 0, 1.5, 0.75, 1.1, '#c4cad0'),
      bx(0, 0.92, 0, 3.0, 0.08, 0.8, '#6b7076'),
      bx(0, 1.6, 0, 1.4, 0.1, 1.0, '#9aa1a8'),
      bx(0.95, 1.2, 0.56, 0.2, 0.3, 0.02, '#1e1e20'),
    ];
    const glow = [bx(0, 0.86, 0.56, 1.3, 0.2, 0.01, '#ffffff'), bx(0, 0.86, -0.56, 1.3, 0.2, 0.01, '#ffffff')];
    return { body: meshOf(parts, WHITE, 'oven'), glow: meshOf(glow, glowMat, 'oven') };
  }
  // wood-fired dome
  const dome = new Mesh(merge([
    { geo: cached('dome', () => sphere(1, 14, 7, false, Math.PI / 2)), pos: [0, 0.95, 0], scale: [1.25, 1.1, 1.25], color: '#b5542f' },
    bx(0, 0, 0, 2.7, 0.95, 2.5, '#8c7a6a'),
    bx(0, 0.92, 0, 2.8, 0.06, 2.6, '#d4c3ab'),
    cy(0.4, 2.0, -0.5, 0.2, 1.4, '#6b2f1a', 8),
    { geo: cached('arch', () => cylinder(0.42, 0.42, 0.3, 10, { thetaStart: -Math.PI / 2, thetaLength: Math.PI })), pos: [0, 0.98, 1.2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1], color: '#1a0f0a' },
  ]), WHITE);
  dome.userData.pick = 'oven';
  const glow = meshOf([bx(0, 0.98, 1.27, 0.7, 0.36, 0.01, '#ffffff')], glowMat, 'oven');
  const fireMat = new Material({ color: '#ffb347', emissive: '#ff6a1a', emissiveIntensity: 1.6, unlit: true });
  const fire = meshOf([cone(-0.15, 0.98, 0.7, 0.16, 0.45, '#ffb347', 6), cone(0.15, 0.98, 0.75, 0.13, 0.35, '#ff8a2a', 6), cone(0, 0.98, 0.6, 0.2, 0.55, '#ffd27a', 6)], fireMat);
  fire.castShadow = false;
  return { body: dome, glow, fire };
}

export function storage(level: number): Part[] {
  const crate = (x: number, z: number, y: number, c: string) => bx(x, y, z, 0.5, 0.32, 0.4, c);
  if (level === 0) {
    const p: Part[] = [];
    for (let i = 0; i < 4; i++) p.push(bx(0, 0.02 + i * 0.5, 0, 2.0, 0.04, 0.55, '#8f969d'));
    for (const x of [-0.97, 0.97]) p.push(bx(x, 0, 0, 0.05, 1.9, 0.55, '#6b7076'));
    const cols = ['#e8c98f', '#c8352a', '#f6efd2', '#2f6fd1', '#c99a62', '#3e8a3a'];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) p.push(crate(-0.6 + j * 0.6, 0, 0.06 + i * 0.5, cols[(i * 3 + j) % cols.length]));
    return p;
  }
  if (level === 1) {
    return [
      bx(0, 0, 0, 1.2, 2.1, 0.8, '#d9dde1'),
      bx(0, 0.1, 0.41, 1.1, 1.9, 0.02, '#c4cad0'),
      bx(0.45, 0.9, 0.43, 0.05, 0.5, 0.04, '#6b7076'),
      bx(-1.3, 0, 0, 1.2, 2.1, 0.8, '#d9dde1'),
      bx(-1.3, 0.1, 0.41, 1.1, 1.9, 0.02, '#c4cad0'),
      bx(-0.85, 0.9, 0.43, 0.05, 0.5, 0.04, '#6b7076'),
    ];
  }
  const w = level === 2 ? 2.6 : 3.4;
  return [
    bx(0, 0, 0, w, 2.5, 2.0, '#cfd5da'),
    bx(0, 2.5, 0, w + 0.1, 0.08, 2.1, '#9aa1a8'),
    bx(w / 2 - 0.65, 0.05, 1.01, 0.95, 2.1, 0.04, '#b9c0c6'),
    bx(w / 2 - 0.3, 1.0, 1.04, 0.06, 0.5, 0.05, '#55595e'),
    bx(-w / 2 + 0.5, 2.0, 1.02, 0.6, 0.25, 0.02, '#3e8a3a'),
  ];
}

export function drinksFridge(): { body: Mesh; glow: Mesh } {
  const body = meshOf([bx(0, 0, 0, 0.75, 1.75, 0.65, '#d8402b'), bx(0, 1.6, 0.33, 0.7, 0.14, 0.02, '#f6f1e6')], WHITE, 'menu');
  const glow = meshOf([bx(0, 0.15, 0.335, 0.6, 1.35, 0.01, '#ffffff')], new Material({ color: '#cfe6ff', emissive: '#9fd0ff', emissiveIntensity: 0.6 }), 'menu');
  return { body, glow };
}

export function dishwasher(): Part[] {
  return [bx(0, 0, 0, 0.8, 0.95, 0.7, '#b9bdc2'), bx(0, 0.95, 0, 1.6, 0.05, 0.75, '#d9dde1'), bx(-0.4, 0.98, 0, 0.6, 0.12, 0.5, '#8f969d'), bx(0, 0.3, 0.36, 0.6, 0.04, 0.02, '#55595e')];
}
export function scrubber(): Part[] {
  return [bx(0, 0.1, 0, 0.7, 0.45, 0.9, '#2f6fd1'), cy(-0.3, 0, 0.3, 0.12, 0.08, '#222', 8), cy(0.3, 0, 0.3, 0.12, 0.08, '#222', 8), bx(0, 0.55, -0.35, 0.5, 0.6, 0.06, '#1b4f9a'), bx(0, 1.1, -0.4, 0.6, 0.05, 0.05, '#222')];
}

export function breakroom(level: number): Part[] {
  const p: Part[] = [...table('#d9c7a5', false).map((q) => ({ ...q, pos: [q.pos![0], q.pos![1], q.pos![2]] as V3 }))];
  p.push(...chair(-0.62, 0, Math.PI / 2, '#3f9b4a'), ...chair(0.62, 0, -Math.PI / 2, '#3f9b4a'));
  p.push(bx(1.3, 0, -0.45, 0.6, 0.9, 0.5, '#b9bdc2'), bx(1.3, 0.9, -0.45, 0.3, 0.38, 0.3, '#2b2b2e'), cy(1.38, 0.95, -0.25, 0.05, 0.1, '#f6f1e6', 8));
  if (level >= 2) {
    p.push(bx(-1.6, 0, -0.3, 0.9, 0.42, 1.8, '#5b6fa8'), bx(-1.95, 0.42, -0.3, 0.25, 0.5, 1.8, '#4a5b8f'), bx(-1.6, 0.42, -1.12, 0.9, 0.3, 0.16, '#4a5b8f'), bx(-1.6, 0.42, 0.52, 0.9, 0.3, 0.16, '#4a5b8f'));
  }
  return p;
}

export function desk(): Part[] {
  return [bx(0, 0, 0, 1.2, 0.75, 0.6, '#6d4730'), bx(0.1, 0.75, -0.05, 0.42, 0.02, 0.3, '#2b2b2e'), bx(0.1, 0.77, -0.18, 0.42, 0.28, 0.02, '#1a1a1d', [-0.25, 0, 0]), bx(-0.35, 0.75, 0.05, 0.22, 0.02, 0.3, '#f6f1e6')];
}

export function jukebox(): { body: Mesh; glow: Mesh } {
  const body = meshOf([bx(0, 0, 0, 0.8, 1.2, 0.55, '#6b2f1a'), { geo: cached('jbtop', () => cylinder(0.4, 0.4, 0.55, 12, { thetaStart: -Math.PI / 2, thetaLength: Math.PI })), pos: [0, 1.2, 0], rot: [Math.PI / 2, 0, Math.PI / 2], color: '#7a3a22' }], WHITE, 'decor');
  const glow = meshOf([bx(0, 0.35, 0.28, 0.6, 0.6, 0.02, '#ffffff'), bx(-0.36, 0.1, 0.28, 0.05, 1.3, 0.02, '#ffffff'), bx(0.36, 0.1, 0.28, 0.05, 1.3, 0.02, '#ffffff')], new Material({ color: '#ffe0a0', emissive: '#ff5fa2', emissiveIntensity: 0.9 }), 'decor');
  return { body, glow };
}

export function pendant(): Part[] {
  return [cy(0, 0.45, 0, 0.01, 1.2, '#222', 4), cone(0, 0, 0, 0.28, 0.45, '#1f3b2a', 10)];
}

// ------------------------------------------------------------------ outside

export function tree(x: number, z: number, s = 1, tint = '#3f8a46'): Part[] {
  return [
    cy(x, 0, z, 0.12 * s, 1.4 * s, '#6b4a2e', 6),
    sp(x, 1.9 * s, z, 0.9 * s, tint, true),
    sp(x + 0.4 * s, 2.3 * s, z + 0.2 * s, 0.6 * s, '#4f9f52', true),
    sp(x - 0.35 * s, 2.25 * s, z - 0.25 * s, 0.55 * s, '#357a3d', true),
  ];
}
export function pine(x: number, z: number, s = 1): Part[] {
  return [cy(x, 0, z, 0.1 * s, 0.6 * s, '#5b3d24', 6), cone(x, 0.5 * s, z, 0.85 * s, 1.5 * s, '#2f6a3a', 7), cone(x, 1.4 * s, z, 0.6 * s, 1.2 * s, '#3a7a44', 7)];
}
export function lamp(x: number, z: number): { pole: Part[]; bulb: Part[] } {
  return {
    pole: [cy(x, 0, z, 0.06, 3.6, '#2b2b2e', 6), bx(x, 3.55, z - 0.35, 0.08, 0.08, 0.8, '#2b2b2e')],
    bulb: [bx(x, 3.42, z - 0.65, 0.3, 0.12, 0.3, '#ffffff')],
  };
}
export function bench(x: number, z: number, face = 0): Part[] {
  return [bx(x, 0.4, z, 1.6, 0.06, 0.45, '#8a5a35', [0, face, 0]), bx(x - 0.65, 0, z, 0.08, 0.4, 0.4, '#2b2b2e'), bx(x + 0.65, 0, z, 0.08, 0.4, 0.4, '#2b2b2e')];
}
export function house(x: number, z: number, w: number, d: number, wall: string, roof: string): Part[] {
  const h = 3;
  return [
    bx(x, 0, z, w, h, d, wall),
    bx(x, h + Math.tan(0.6) * (d / 4) - 0.35, z + d / 4, w + 0.4, 0.12, d / 2 / Math.cos(0.6) + 0.35, roof, [0.6, 0, 0]),
    bx(x, h + Math.tan(0.6) * (d / 4) - 0.35, z - d / 4, w + 0.4, 0.12, d / 2 / Math.cos(0.6) + 0.35, roof, [-0.6, 0, 0]),
    bx(x, h, z, w - 0.02, Math.tan(0.6) * (d / 2) - 0.1, 0.1, wall),
    bx(x, 0, z + d / 2 + 0.01, 0.9, 2, 0.05, '#6d4730'),
    bx(x - w / 3, 1.2, z + d / 2 + 0.01, 0.9, 0.9, 0.05, '#cfe3f0'),
    bx(x + w / 3, 1.2, z + d / 2 + 0.01, 0.9, 0.9, 0.05, '#cfe3f0'),
  ];
}
export function car(color: string): Part[] {
  return [
    bx(0, 0.25, 0, 3.6, 0.6, 1.6, color),
    bx(-0.2, 0.85, 0, 2.0, 0.55, 1.45, color),
    bx(-0.2, 0.9, 0, 2.05, 0.42, 1.48, '#2c3e50'),
    ...[-1.15, 1.15].flatMap((x) => [-0.78, 0.78].map((z) => ({ geo: CYL(10), pos: [x, 0.33, z] as V3, rot: [Math.PI / 2, 0, 0] as V3, scale: [0.62, 0.22, 0.62] as V3, color: '#1c1c1c' }))),
    bx(1.79, 0.45, 0.5, 0.04, 0.15, 0.3, '#fff3c4'),
    bx(1.79, 0.45, -0.5, 0.04, 0.15, 0.3, '#fff3c4'),
  ];
}

export function vehicle(level: number): Part[] {
  if (level <= 1) {
    // bicycle with a pizza box carrier
    const wheel = (x: number): Part => ({ geo: cached('wheel', () => cylinder(0.32, 0.32, 0.05, 14)), pos: [x, 0.34, 0], rot: [Math.PI / 2, 0, 0], color: '#1c1c1c' });
    return [wheel(-0.5), wheel(0.5), bx(0, 0.35, 0, 1.0, 0.05, 0.05, '#c8352a'), bx(0.1, 0.35, 0, 0.05, 0.5, 0.05, '#c8352a'), bx(0.45, 0.35, 0, 0.05, 0.55, 0.05, '#c8352a'), bx(0.45, 0.9, 0, 0.05, 0.05, 0.5, '#2b2b2e'), bx(0.1, 0.85, 0, 0.25, 0.06, 0.12, '#2b2b2e'), bx(-0.5, 0.7, 0, 0.5, 0.35, 0.45, '#c99a62')];
  }
  if (level === 2) {
    const wheel = (x: number): Part => ({ geo: cached('swheel', () => cylinder(0.24, 0.24, 0.12, 12)), pos: [x, 0.24, 0], rot: [Math.PI / 2, 0, 0], color: '#1c1c1c' });
    return [wheel(-0.55), wheel(0.55), bx(-0.1, 0.25, 0, 1.0, 0.3, 0.4, '#d8402b'), bx(0.45, 0.25, 0, 0.18, 0.75, 0.32, '#d8402b'), bx(0.5, 1.0, 0, 0.06, 0.06, 0.6, '#2b2b2e'), bx(-0.15, 0.6, 0, 0.6, 0.1, 0.32, '#2b2b2e'), bx(-0.6, 0.6, 0, 0.5, 0.5, 0.5, '#f6f1e6'), bx(-0.6, 0.75, 0.26, 0.4, 0.2, 0.01, '#c8352a')];
  }
  return [
    bx(0, 0.25, 0, 3.4, 1.6, 1.7, '#f6f1e6'),
    bx(1.3, 0.25, 0, 0.8, 1.2, 1.72, '#f6f1e6'),
    bx(1.45, 0.95, 0, 0.6, 0.5, 1.74, '#2c3e50'),
    bx(-0.3, 0.9, 0.86, 2.0, 0.5, 0.01, '#c8352a'),
    bx(-0.3, 0.6, 0.86, 2.0, 0.12, 0.01, '#3f9b4a'),
    ...[-1.1, 1.1].flatMap((x) => [-0.8, 0.8].map((z) => ({ geo: CYL(10), pos: [x, 0.33, z] as V3, rot: [Math.PI / 2, 0, 0] as V3, scale: [0.62, 0.22, 0.62] as V3, color: '#1c1c1c' }))),
  ];
}

export function boat(): Part[] {
  return [bx(0, 0, 0, 4, 0.7, 1.4, '#f6f1e6'), bx(0, 0.7, 0, 3.6, 0.1, 1.2, '#9b7a55'), bx(-0.3, 0.8, 0, 1.4, 0.8, 1.0, '#f6f1e6'), cy(0.6, 0.8, 0, 0.05, 3.2, '#d9dde1', 6)];
}
export function plane3d(): Part[] {
  return [
    { geo: CYLS(14), pos: [0, 2.2, 0], rot: [0, 0, Math.PI / 2], scale: [2.2, 16, 2.2], color: '#f4f4f4' },
    bx(0, 1.9, 0, 3.2, 0.25, 15, '#e3e3e3'),
    bx(-7.4, 3.2, 0, 2.2, 2.4, 0.25, '#c8352a'),
    bx(-7.4, 2.3, 0, 1.5, 0.15, 5, '#e3e3e3'),
    { geo: CONE(14), pos: [8.6, 2.2, 0], rot: [0, 0, -Math.PI / 2], scale: [2.2, 1.4, 2.2], color: '#f4f4f4' },
  ];
}

// ------------------------------------------------------------------ pizza & boxes

const pizzaGeoCache = new Map<string, Geometry>();
export function pizzaGeo(toppings: string[], sauce = '#c8352a'): Geometry {
  const key = toppings.join(',') + sauce;
  let g = pizzaGeoCache.get(key);
  if (!g) {
    const parts: Part[] = [cy(0, 0, 0, 0.26, 0.035, '#d9a15a', 16, true), cy(0, 0.03, 0, 0.225, 0.012, sauce, 16, true), cy(0, 0.038, 0, 0.21, 0.01, '#f6e7b4', 16, true)];
    const n = toppings.length;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + i * 0.4;
      const r = 0.06 + (i % 3) * 0.05;
      parts.push(cy(Math.cos(a) * r, 0.045, Math.sin(a) * r, 0.03, 0.012, n ? toppings[i % n] : '#3f9b4a', 6));
    }
    g = merge(parts);
    pizzaGeoCache.set(key, g);
  }
  return g;
}
/** A pizza with some slices eaten: `left` of 8 slices remain, taken clockwise. */
const partCache = new Map<string, Geometry>();
export function pizzaLeftGeo(toppings: string[], left: number, sauce = '#c8352a'): Geometry {
  const n = Math.max(0, Math.min(8, Math.round(left)));
  const key = toppings.join(',') + sauce + '|' + n;
  let g = partCache.get(key);
  if (!g) {
    if (n >= 8) g = pizzaGeo(toppings, sauce);
    else {
      const arc = (n / 8) * Math.PI * 2;
      const wedge = (r: number, h: number, y: number, c: string): Part => ({ geo: cylinder(1, 1, 1, Math.max(3, n * 2), { thetaStart: 0, thetaLength: Math.max(0.001, arc) }), pos: [0, y + h / 2, 0], scale: [r, h, r], color: c });
      const parts: Part[] = n ? [wedge(0.26, 0.035, 0, '#d9a15a'), wedge(0.225, 0.012, 0.03, sauce), wedge(0.21, 0.01, 0.038, '#f6e7b4')] : [];
      const k = toppings.length;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + i * 0.4;
        const ang = ((Math.PI / 2 - a) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
        if (ang > arc - 0.15) continue;
        const r = 0.06 + (i % 3) * 0.05;
        parts.push(cy(Math.cos(a) * r, 0.045, Math.sin(a) * r, 0.03, 0.012, k ? toppings[i % k] : '#3f9b4a', 6));
      }
      // crumbs where the eaten slices were
      for (let i = 0; i < 5; i++) {
        const a = arc + ((Math.PI * 2 - arc) * (i + 0.5)) / 5;
        parts.push(cy(Math.sin(a) * 0.15, 0.005, Math.cos(a) * 0.15, 0.012, 0.008, '#c98a4a', 5));
      }
      g = merge(parts);
    }
    partCache.set(key, g);
  }
  return g;
}

export function pizzaBox(): Part[] {
  return [bx(0, 0, 0, 0.55, 0.07, 0.55, '#c99a62'), bx(0, 0.07, 0, 0.3, 0.003, 0.3, '#c8352a')];
}
export function plate(): Part[] {
  return [cy(0, 0, 0, 0.3, 0.02, '#f6f6f2', 14, true)];
}

// ------------------------------------------------------------------ signs

export function sliceSign(): Part[] {
  const wedge = cached('wedge', () => cylinder(1, 1, 0.25, 6, { thetaStart: -0.35, thetaLength: 0.7 }));
  return [
    { geo: wedge, pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [1.6, 1, 1.6], color: '#e8b04a' },
    { geo: cached('crust', () => cylinder(1, 1, 0.32, 6, { thetaStart: -0.35, thetaLength: 0.7 })), pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [1.72, 1.1, 1.72], color: '#b8783a' },
    ...[[0.7, 0.05], [1.05, -0.12], [1.1, 0.16]].map(([r, a]) => ({ geo: CYL(10), pos: [Math.sin(a) * r * 1.6, -Math.cos(a) * r * 1.6, 0.16] as V3, rot: [Math.PI / 2, 0, 0] as V3, scale: [0.26, 0.05, 0.26] as V3, color: '#b53a2a' })),
  ];
}

export { Node, Mesh, Material };

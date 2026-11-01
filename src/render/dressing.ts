// Extra set dressing: the little details that make the shop feel lived in, plus
// live props driven by the simulation (OPEN sign, wall clock, order tickets, boxes).
import { cached, cylinder, merge, panelUV, sphere, box, type Part } from '../engine/geometry';
import { Material, Mesh, Node, Texture } from '../engine/scene';
import type { V3 } from '../engine/math';
import { bx, cy, meshOf, WHITE } from './props';
import { FONT_DISPLAY, FONT_UI } from './textures';

// ---------------------------------------------------------------- textures

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return new Texture(c, { repeat: false });
}

const texCache = new Map<string, Texture>();
function once(key: string, make: () => Texture) {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}
/** Drop cached text textures (after web fonts finish loading). */
export function resetDressingTextures() {
  texCache.clear();
}

export function openSignTex(open: boolean) {
  return once('open' + open, () =>
    canvasTex(256, 112, (g) => {
      g.fillStyle = '#151214';
      roundRect(g, 4, 4, 248, 104, 18);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = open ? '#ff4f6d' : '#4a4246';
      roundRect(g, 12, 12, 232, 88, 14);
      g.stroke();
      g.font = `${open ? 64 : 50}px ${FONT_DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (open) {
        g.shadowColor = '#ff2f55';
        g.shadowBlur = 16;
      }
      g.fillStyle = open ? '#ffd3dc' : '#6d6468';
      g.fillText(open ? 'OPEN' : 'CLOSED', 128, 60);
    }),
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const TICKET_COLORS: Record<string, string> = { dine: '#c8352a', takeout: '#d9951c', delivery: '#2f6fd1' };
export function ticketTex(kind: string) {
  return once('ticket' + kind, () =>
    canvasTex(64, 96, (g) => {
      g.fillStyle = '#fbf6ea';
      g.fillRect(0, 0, 64, 96);
      g.fillStyle = TICKET_COLORS[kind] ?? '#c8352a';
      g.fillRect(0, 0, 64, 18);
      g.fillStyle = '#8a6f5a';
      for (let i = 0; i < 5; i++) g.fillRect(8, 28 + i * 11, 30 + ((i * 13) % 20), 4);
      // torn bottom edge
      g.fillStyle = '#000';
      g.globalCompositeOperation = 'destination-out';
      for (let x = 0; x < 64; x += 8) {
        g.beginPath();
        g.moveTo(x, 96);
        g.lineTo(x + 4, 90);
        g.lineTo(x + 8, 96);
        g.fill();
      }
    }),
  );
}

function clockFaceTex() {
  return once('clock', () =>
    canvasTex(128, 128, (g) => {
      g.fillStyle = '#fbf6ea';
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2b1d14';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r1 = i % 3 === 0 ? 44 : 50;
        g.save();
        g.translate(64 + Math.sin(a) * 52, 64 - Math.cos(a) * 52);
        g.rotate(a);
        g.fillRect(-2, 0, 4, 56 - r1);
        g.restore();
      }
      g.font = `18px ${FONT_DISPLAY}`;
      g.textAlign = 'center';
      g.fillStyle = '#c8352a';
      g.fillText('PIZZA', 64, 92);
    }),
  );
}

function sackLabelTex() {
  return once('sack', () =>
    canvasTex(64, 64, (g) => {
      g.fillStyle = '#efe6d2';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#c8352a';
      g.fillRect(0, 22, 64, 18);
      g.fillStyle = '#fff';
      g.font = `bold 12px ${FONT_UI}`;
      g.textAlign = 'center';
      g.fillText('FLOUR 00', 32, 36);
    }),
  );
}

// ---------------------------------------------------------------- static dressing

/** Props every store has, even on day one. */
export function starterProps(): Node {
  const n = new Node();
  const parts: Part[] = [
    // door mat
    bx(-0.6, 0.005, 4.55, 1.5, 0.02, 0.8, '#3a2a20'),
    bx(-0.6, 0.012, 4.55, 1.3, 0.02, 0.62, '#5a3a22'),
    // pizza peel leaning on the back wall
    bx(-6.72, 0.0, -4.85, 0.06, 1.2, 0.05, '#8a5a35', [0.1, 0, 0]),
    bx(-6.72, 1.2, -4.9, 0.42, 0.5, 0.03, '#b98a55', [0.1, 0, 0]),
    // spice shelf on the kitchen side wall
    bx(-6.84, 1.9, -3.1, 0.26, 0.05, 1.6, '#6d4730'),
    bx(-6.93, 1.7, -3.8, 0.08, 0.22, 0.05, '#3a2a20'),
    bx(-6.93, 1.7, -2.4, 0.08, 0.22, 0.05, '#3a2a20'),
    cy(-6.84, 1.95, -3.7, 0.09, 0.26, '#c8352a', 8),
    cy(-6.84, 1.95, -3.4, 0.08, 0.2, '#f2d34b', 8),
    cy(-6.84, 1.95, -3.1, 0.09, 0.3, '#3f9b4a', 8),
    cy(-6.84, 1.95, -2.8, 0.07, 0.22, '#f6efd2', 8),
    cy(-6.84, 1.95, -2.52, 0.09, 0.26, '#6b2f1a', 8),
    // boxwood planters by the door
    bx(-1.85, 0, 5.62, 0.5, 0.45, 0.5, '#5a3a22'),
    bx(0.65, 0, 5.62, 0.5, 0.45, 0.5, '#5a3a22'),
    // mop bucket
    cy(0.45, 0, -4.6, 0.22, 0.34, '#f2b33d', 10),
    cy(0.45, 0.34, -4.6, 0.2, 0.02, '#4a6f8f', 10),
    bx(0.55, 0.3, -4.65, 0.04, 1.1, 0.04, '#8a5a35', [0, 0, -0.25]),
    // trash can by the pickup corner
    cy(-6.55, 0, 2.95, 0.24, 0.62, '#55595e', 10),
    cy(-6.55, 0.62, 2.95, 0.26, 0.05, '#3a3d41', 10),
    // napkin dispenser and straws on the counter
    bx(-3.4, 1.06, -0.98, 0.18, 0.16, 0.12, '#d9dde1'),
    bx(-3.4, 1.12, -0.92, 0.12, 0.08, 0.01, '#fbf6ea'),
    cy(-0.05, 1.06, -1.0, 0.06, 0.22, '#c8352a', 8),
    // tip jar
    cy(0.35, 1.06, -0.98, 0.08, 0.18, '#cfe6f5', 10),
    cy(0.35, 1.07, -0.98, 0.06, 0.06, '#3f9b4a', 8),
    // wall light sconces
    bx(-6.97, 2.25, 2.3, 0.08, 0.28, 0.16, '#2b2724'),
    bx(-6.97, 2.25, 4.3, 0.08, 0.28, 0.16, '#2b2724'),
  ];
  n.add(meshOf(parts));
  const shrubs = meshOf([
    { geo: cached('shrub', () => sphere(0.5, 8, 6, false)), pos: [-1.85, 0.72, 5.62], scale: [0.62, 0.62, 0.62], color: '#3f7f3f' },
    { geo: cached('shrub', () => sphere(0.5, 8, 6, false)), pos: [0.65, 0.72, 5.62], scale: [0.62, 0.62, 0.62], color: '#3f7f3f' },
  ]);
  n.add(shrubs);
  // flour sacks with a printed band
  const sackGeo = cached('sack', () => merge([{ geo: sphere(0.5, 10, 7, true), pos: [0, 0.5, 0], scale: [1, 1, 0.75], color: '#ffffff' }]));
  const sackMat = new Material({ map: sackLabelTex() });
  for (const [x, z, s, r] of [[-6.55, -3.55, 0.62, 0.3], [-6.45, -3.0, 0.55, -0.5], [-6.52, -3.3, 0.5, 1.2]] as const) {
    const m = new Mesh(sackGeo, sackMat);
    m.position = [x, z === -3.3 ? 0.5 : 0, z];
    m.scale = [s, s * 0.85, s];
    m.rotation = [0, r, 0];
    m.userData.pick = 'storage';
    n.add(m);
  }
  // sconce glow (driven at night by the world)
  const glow = meshOf([bx(-6.92, 2.38, 2.3, 0.04, 0.12, 0.12, '#ffffff'), bx(-6.92, 2.38, 4.3, 0.04, 0.12, 0.12, '#ffffff')], new Material({ color: '#fff1cf', emissive: '#ffcf7a', emissiveIntensity: 0.4 }));
  glow.castShadow = false;
  glow.userData.nightGlow = true;
  n.add(glow);
  return n;
}

/** Outside: crosswalk, hydrant, mailbox, bike rack, delivery lot, back alley. */
export function streetProps(decor: number, env: string): Node {
  const n = new Node();
  const parts: Part[] = [];
  // crosswalk
  for (let i = 0; i < 7; i++) parts.push(bx(-8.6, 0.012, 8.6 + i * 0.78, 2.4, 0.01, 0.42, '#ece7dc'));
  // hydrant
  parts.push(cy(3.4, 0, 7.75, 0.14, 0.55, '#c8352a', 8), cy(3.4, 0.55, 7.75, 0.11, 0.12, '#a32a20', 8), bx(3.4, 0.32, 7.75, 0.42, 0.1, 0.1, '#a32a20'));
  // mailbox
  parts.push(bx(-4.6, 0, 7.75, 0.08, 0.7, 0.08, '#2b2b2e'), bx(-4.6, 0.7, 7.75, 0.5, 0.6, 0.42, '#2f5fa8'), bx(-4.6, 1.3, 7.75, 0.42, 0.1, 0.42, '#2a539a'), bx(-4.6, 1.05, 7.97, 0.3, 0.05, 0.01, '#d9dde1'));
  // bike rack
  for (let i = 0; i < 3; i++) {
    const x = -10.9 + i * 0.6;
    parts.push(bx(x, 0, 7.35, 0.05, 0.75, 0.05, '#55595e'), bx(x, 0, 7.85, 0.05, 0.75, 0.05, '#55595e'), bx(x, 0.75, 7.6, 0.05, 0.05, 0.55, '#55595e'));
  }
  // delivery lot (right) with painted bays
  parts.push(bx(10.1, -0.01, 0.1, 5.4, 0.02, 10.2, '#6f6c68'));
  for (const z of [-4.3, -2.5, -0.7, 1.1]) parts.push(bx(10.1, 0.012, z, 3.2, 0.01, 0.08, '#ece7dc'));
  parts.push(bx(12.0, 0.012, -1.6, 0.08, 0.01, 5.4, '#ece7dc'));
  // back lot and alley
  parts.push(bx(2.5, -0.01, -8.2, 22, 0.02, 6, '#7a7671'));
  parts.push(bx(2.0, 0, -11.2, 24, 1.9, 0.25, '#8a3a2a'), bx(2.0, 1.9, -11.2, 24.2, 0.1, 0.35, '#6b2f1a'));
  // dumpster
  parts.push(bx(3.2, 0.1, -6.9, 1.9, 1.1, 1.1, '#2f6a3a'), bx(3.2, 1.2, -6.95, 2.0, 0.08, 1.2, '#24532d', [-0.12, 0, 0]));
  for (const x of [2.5, 3.9]) parts.push(cy(x, 0, -6.45, 0.09, 0.1, '#1c1c1c', 8));
  // a/c unit and pipes on the back wall
  parts.push(bx(-2.5, 0.6, -5.65, 1.1, 0.8, 0.8, '#b9bdc2'), bx(-2.5, 0.68, -6.06, 0.8, 0.6, 0.02, '#8f969d'));
  parts.push(cy(-0.4, 0, -5.3, 0.06, 3.0, '#8f969d', 6));
  // stacked crates by the back door
  parts.push(bx(7.8, 0, -3.6, 0.6, 0.45, 0.5, '#9b7a55'), bx(7.8, 0.45, -3.55, 0.6, 0.45, 0.5, '#8a6a45'), bx(7.85, 0, -4.3, 0.6, 0.45, 0.5, '#9b7a55'));
  if (decor >= 1) {
    // flower boxes under the front windows
    for (const [x, w] of [[-4.35, 4.6], [3.75, 5.8]] as const) {
      parts.push(bx(x, 0.05, 5.48, w, 0.35, 0.4, '#6d4730'));
      for (let i = 0; i < Math.floor(w / 0.35); i++) {
        const fx = x - w / 2 + 0.2 + i * 0.35;
        parts.push({ geo: cached('bloom', () => sphere(0.5, 6, 4, false)), pos: [fx, 0.48, 5.48 + ((i * 7) % 3) * 0.05 - 0.05], scale: [0.22, 0.2, 0.22], color: ['#e76f51', '#f2d34b', '#f6f1e6', '#c8352a', '#8e5bb5'][i % 5] });
        parts.push({ geo: cached('leaf', () => sphere(0.5, 6, 4, false)), pos: [fx + 0.15, 0.42, 5.42], scale: [0.2, 0.16, 0.2], color: '#3f8a46' });
      }
    }
  }
  if (decor >= 3) {
    // sidewalk cafe table with umbrella
    parts.push(cy(-9.2, 0, 6.2, 0.04, 0.72, '#2b2b2e', 6), cy(-9.2, 0.72, 6.2, 0.38, 0.04, '#f6f1e6', 12), cy(-9.2, 0.7, 6.2, 0.03, 1.6, '#6d4730', 6));
    parts.push({ geo: cached('umb', () => cylinder(0, 1.2, 0.5, 8)), pos: [-9.2, 2.35, 6.2], color: '#c8352a' });
  }
  n.add(meshOf(parts));
  // back-alley buildings (lit windows at night are handled by facade textures in world)
  void env;
  return n;
}

// ---------------------------------------------------------------- live props

export class LiveProps {
  root = new Node();
  openSign: Mesh;
  private hourHand: Node;
  private minHand: Node;
  private tickets: Mesh[] = [];
  private boxes: Mesh[] = [];
  private ticketSig = '';

  constructor() {
    // OPEN sign inside the right front window, facing the street
    this.openSign = new Mesh(panelUV(0.95, 0.42, 1, 1), new Material({ map: openSignTex(false), unlit: true }));
    this.openSign.position = [5.2, 1.32, 4.97];
    this.openSign.castShadow = false;
    this.openSign.userData.pick = 'sign';
    this.root.add(this.openSign);
    const chain = meshOf([bx(4.95, 1.53, 4.97, 0.01, 1.3, 0.01, '#55595e'), bx(5.45, 1.53, 4.97, 0.01, 1.3, 0.01, '#55595e')]);
    chain.castShadow = false;
    this.root.add(chain);

    // wall clock on the back wall
    const clock = new Node().at(-0.3, 2.45, -4.96);
    const face = new Mesh(cached('clockface', () => cylinder(0.32, 0.32, 0.06, 20)), new Material({ color: '#2b2724' }));
    face.rotation = [Math.PI / 2, 0, 0];
    clock.add(face);
    const dial = new Mesh(panelUV(0.56, 0.56, 1, 1), new Material({ map: clockFaceTex() }));
    dial.position = [0, 0, 0.035];
    dial.castShadow = false;
    clock.add(dial);
    this.hourHand = new Node().at(0, 0, 0.045);
    this.minHand = new Node().at(0, 0, 0.05);
    const handGeo = (len: number) => cached('hand' + len, () => merge([{ geo: box(1, 1, 1), pos: [0, len / 2, 0], scale: [0.03, len, 0.01] }]));
    const hm = new Mesh(handGeo(0.14), new Material({ color: '#2b1d14' }));
    const mm = new Mesh(handGeo(0.21), new Material({ color: '#2b1d14' }));
    hm.castShadow = mm.castShadow = false;
    this.hourHand.add(hm);
    this.minHand.add(mm);
    clock.add(this.hourHand, this.minHand);
    this.root.add(clock);

    // order ticket rail on the back wall, above the make line
    const rail = meshOf([bx(-2.55, 2.3, -4.93, 3.5, 0.06, 0.07, '#b9bdc2'), bx(-2.55, 2.27, -4.96, 3.6, 0.02, 0.02, '#8f969d')]);
    rail.castShadow = false;
    rail.userData.pick = 'prep';
    this.root.add(rail);
    for (let i = 0; i < 10; i++) {
      const t = new Mesh(panelUV(0.24, 0.34, 1, 1), new Material({ map: ticketTex('dine') }));
      t.position = [-4.1 + i * 0.345, 2.14, -4.9];
      t.rotation = [0, 0, (i % 3 - 1) * 0.05];
      t.visible = false;
      t.castShadow = false;
      t.userData.pick = 'prep';
      this.tickets.push(t);
      this.root.add(t);
    }

    // boxed orders waiting for a driver on the pickup shelf
    const boxGeo = cached('waitbox', () => merge([{ geo: box(1, 1, 1), pos: [0, 0.035, 0], scale: [0.5, 0.07, 0.5], color: '#c99a62' }, { geo: box(1, 1, 1), pos: [0, 0.071, 0], scale: [0.26, 0.002, 0.26], color: '#c8352a' }]));
    for (let i = 0; i < 8; i++) {
      const b = new Mesh(boxGeo, WHITE);
      b.position = [-4.3 + (i >= 4 ? 0 : 0), 1.1 + (i % 4) * 0.075 + (i >= 4 ? 0 : 0), i >= 4 ? -1.0 : -1.25];
      b.rotation = [0, (i * 0.37) % 0.3 - 0.15, 0];
      b.visible = false;
      b.userData.pick = 'delivery';
      this.boxes.push(b);
      this.root.add(b);
    }
  }

  update(open: boolean, minute: number, kitchenKinds: string[], waitingBoxes: number) {
    const m = this.openSign.material;
    const want = openSignTex(open);
    if (m.map !== want) m.map = want;
    m.glow = open ? 1.1 : 0;
    m.color = open ? [1.15, 1.15, 1.15] : [0.85, 0.85, 0.85];
    const h = (minute / 60) % 12;
    this.hourHand.rotation = [0, 0, -(h / 12) * Math.PI * 2];
    this.minHand.rotation = [0, 0, -((minute % 60) / 60) * Math.PI * 2];
    const sig = kitchenKinds.join(',');
    if (sig !== this.ticketSig) {
      this.ticketSig = sig;
      this.tickets.forEach((t, i) => {
        const k = kitchenKinds[i];
        t.visible = !!k;
        if (k) t.material.map = ticketTex(k);
      });
    }
    this.boxes.forEach((b, i) => (b.visible = i < waitingBoxes));
  }
}

export type { V3 };

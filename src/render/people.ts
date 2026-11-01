// Low-poly people. 0.4.0: arms bend at the elbow and end in hands, everyone has shoes and a
// face, and poses blend smoothly instead of snapping. Staff act out what they're doing: building
// pizzas, sliding them into the oven, wiping tables, sweeping. Seated customers eat slice by slice.
import { box, cached, cylinder, merge, sphere, type Part } from '../engine/geometry';
import { Material, Mesh, Node, Sprite } from '../engine/scene';
import type { V3 } from '../engine/math';
import type { Look } from '../core/types';
import type { Role } from '../data/world';
import { moodTex } from './textures';
import { WHITE, pizzaBox, plate, pizzaGeo } from './props';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#9d6a48', '#7a4e33', '#5a3825'];
const HAIR = ['#2b1d14', '#5a3825', '#a5682f', '#d9b36a', '#1c1c1c', '#8a8a8a', '#7a2f1f'];
const SHIRT = ['#2f6fd1', '#3f9b4a', '#e3a21a', '#8e5bb5', '#d8402b', '#2a9d8f', '#f4a261', '#264653', '#e76f51', '#6d597a'];
const PANTS = ['#2b3a55', '#3a3a3a', '#6b4a2e', '#4a5b3a', '#1d2a3a'];
const SHOES = ['#2b2420', '#3b2a20', '#1d1d1d', '#5a3a26'];

const ROLE_SHIRT: Record<Role, string> = { cook: '#f6f4ee', front: '#c8352a', driver: '#2f6fd1', manager: '#2b2724' };

const boxG = () => cached('pbox', () => box(1, 1, 1));
const head = () => cached('phead', () => sphere(0.5, 12, 9, true));
const torso = () => cached('ptorso', () => cylinder(0.5, 0.42, 1, 10, { smooth: true }));
const limb = () => cached('plimb', () => cylinder(0.5, 0.45, 1, 8, { smooth: true }));
const ball = () => cached('pball', () => sphere(0.5, 8, 6, true));
// Chef hat built from y = 0 up, so it sits on the head where it's placed.
const hatChef = () => cached('phatchef2', () => merge([{ geo: cylinder(0.5, 0.5, 1, 10, { smooth: true }), pos: [0, 0.13, 0], scale: [0.27, 0.26, 0.27] }, { geo: sphere(0.5, 10, 6, true), pos: [0, 0.3, 0], scale: [0.36, 0.22, 0.36] }]));
const capG = () => cached('pcap', () => merge([{ geo: sphere(0.5, 10, 6, true, Math.PI / 2), pos: [0, 0, 0], scale: [0.27, 0.22, 0.27] }, { geo: box(1, 1, 1), pos: [0, 0.02, 0.15], scale: [0.2, 0.02, 0.16] }]));
const helmetG = () => cached('phelm', () => sphere(0.5, 10, 6, true, Math.PI / 2));
const hairG = () => cached('phair', () => sphere(0.5, 10, 6, true, Math.PI * 0.55));

const matCache = new Map<string, Material>();
function mat(c: string) {
  let m = matCache.get(c);
  if (!m) {
    m = new Material({ color: c });
    matCache.set(c, m);
  }
  return m;
}

/** What someone is doing, which picks their pose. */
export type Action = 'idle' | 'sit' | 'eat' | 'make' | 'oven' | 'wipe' | 'sweep' | 'order' | 'scribble';

/** Joint angles for one pose. Arms: shoulder [forward, -, out], elbow bend (radians). */
interface Pose {
  legL: number; legR: number;
  shL: V3; shR: V3;
  elL: number; elR: number;
  bodyY: number; lean: number; twist: number;
}
const ZERO = (): Pose => ({ legL: 0, legR: 0, shL: [0, 0, 0], shR: [0, 0, 0], elL: 0, elR: 0, bodyY: 0, lean: 0, twist: 0 });

/** Detail level: low skips the small extras (tools in hand, eating slices) on slow devices. */
export const PEOPLE_DETAIL = { high: true };

export class Person extends Node {
  legL: Mesh;
  legR: Mesh;
  armL: Mesh;
  armR: Mesh;
  bodyGroup = new Node();
  chest = new Node();
  shL: Node;
  shR: Node;
  elL: Node;
  elR: Node;
  bubble: Sprite;
  carry: Mesh;
  plate: Mesh;
  /** Mop/broom for front staff, clipboard or notebook for special visitors. */
  tool: Mesh | null = null;
  /** Small things held in the right hand: a rag, a peel, a slice. */
  rag: Mesh;
  peel: Mesh;
  slice: Mesh;
  phase = Math.random() * 10;
  walking = false;
  sitting = false;
  working = false;
  /** What they're doing when standing still (the world sets this each frame). */
  action: Action = 'idle';
  /** Path to follow (world x,z). */
  path: [number, number][] = [];
  dest: [number, number] = [0, 0];
  facing = 0;
  targetFacing = 0;
  despawn = false;
  heightScale: number;
  /** Special visitors get their own outfit: the inspector and the food critic. */
  special: 'logan' | 'critic' | null;
  private pose: Pose = ZERO();
  private walkBlend = 0;
  constructor(look: Look, role: Role | null, special: 'logan' | 'critic' | null = null) {
    super();
    this.special = special;
    const skin = special === 'logan' ? '#e7b48f' : special === 'critic' ? '#f0cfae' : SKIN[look.skin % SKIN.length];
    const shirt = special === 'logan' ? '#55595f' : special === 'critic' ? '#9a7442' : role ? ROLE_SHIRT[role] : SHIRT[look.shirt % SHIRT.length];
    const pants = special === 'logan' ? '#2b2d36' : special === 'critic' ? '#3a2e26' : role === 'cook' ? '#3a3a3a' : PANTS[look.pants % PANTS.length];
    const shoe = role === 'cook' ? '#1d1d1d' : SHOES[(look.pants + look.skin) % SHOES.length];
    this.heightScale = look.height;
    this.add(this.bodyGroup);
    const B = this.bodyGroup;
    // legs pivot from the hip, with a shoe at the bottom
    const legGeo = cached('pleg|' + pants + '|' + shoe, () =>
      merge([
        { geo: limb(), pos: [0, -0.36, 0], scale: [0.15, 0.72, 0.17], color: pants },
        { geo: ball(), pos: [0, -0.74, 0.045], scale: [0.16, 0.09, 0.25], color: shoe },
      ]),
    );
    const hipL = new Node().at(-0.1, 0.78, 0);
    const hipR = new Node().at(0.1, 0.78, 0);
    this.legL = new Mesh(legGeo, WHITE);
    this.legR = new Mesh(legGeo, WHITE);
    hipL.add(this.legL);
    hipR.add(this.legR);
    B.add(hipL, hipR);
    // body, head and headwear share one baked mesh per look (fewer draw calls); the chest node
    // lets the upper body lean and twist while the legs stay planted
    this.chest.position = [0, 0.78, 0];
    B.add(this.chest);
    const hairCol = HAIR[look.hair % HAIR.length];
    const key = `${special ?? role ?? 'guest'}|${skin}|${shirt}|${hairCol}`;
    const body = cached('pbody2|' + key, () => {
      const y0 = -0.78; // parts are placed in body space, then shifted into the chest node
      const parts: Part[] = [
        { geo: torso(), pos: [0, 1.06 + y0, 0], scale: [0.46, 0.62, 0.3], color: shirt },
        { geo: ball(), pos: [0, 1.35 + y0, 0], scale: [0.5, 0.16, 0.3], color: shirt }, // rounded shoulders
        { geo: head(), pos: [0, 1.58 + y0, 0], scale: [0.3, 0.32, 0.3], color: skin },
        // eyes, nose and a small smile
        { geo: ball(), pos: [-0.062, 1.605 + y0, 0.135], scale: [0.04, 0.055, 0.03], color: '#2b1d14' },
        { geo: ball(), pos: [0.062, 1.605 + y0, 0.135], scale: [0.04, 0.055, 0.03], color: '#2b1d14' },
        { geo: ball(), pos: [0, 1.565 + y0, 0.15], scale: [0.045, 0.04, 0.04], color: skin },
        { geo: boxG(), pos: [0, 1.515 + y0, 0.135], scale: [0.07, 0.012, 0.02], color: '#8a4a32' },
      ];
      if (role === 'cook') parts.push({ geo: boxG(), pos: [0, 0.94 + y0, 0.145], scale: [0.34, 0.6, 0.02], color: '#ffffff' }, { geo: boxG(), pos: [0, 0.72 + y0, 0.15], scale: [0.36, 0.05, 0.02], color: '#e9e4da' });
      if (role === 'front') parts.push({ geo: boxG(), pos: [0, 0.86 + y0, 0.15], scale: [0.36, 0.34, 0.02], color: '#2b2724' }, { geo: boxG(), pos: [-0.1, 1.2 + y0, 0.152], scale: [0.09, 0.05, 0.01], color: '#ffffff' });
      if (role === 'manager') parts.push({ geo: boxG(), pos: [0, 1.12 + y0, 0.15], scale: [0.06, 0.4, 0.02], color: '#c8352a' }, { geo: boxG(), pos: [-0.12, 1.22 + y0, 0.152], scale: [0.1, 0.06, 0.01], color: '#f2b33d' });
      if (role === 'driver') parts.push({ geo: boxG(), pos: [0, 1.15 + y0, 0.152], scale: [0.2, 0.08, 0.01], color: '#ffffff' });
      if (special === 'logan') {
        parts.push(
          { geo: boxG(), pos: [0, 1.12 + y0, 0.142], scale: [0.17, 0.44, 0.02], color: '#6f9fdc' }, // shirt
          { geo: boxG(), pos: [0, 1.08 + y0, 0.156], scale: [0.055, 0.38, 0.02], color: '#1f2b4a' }, // tie
          { geo: boxG(), pos: [-0.12, 1.0 + y0, 0.155], scale: [0.012, 0.42, 0.012], color: '#2f5fb8' }, // lanyard
          { geo: boxG(), pos: [-0.12, 0.8 + y0, 0.158], scale: [0.08, 0.1, 0.015], color: '#ffffff' }, // badge
          { geo: boxG(), pos: [0, 1.47 + y0, 0.1], scale: [0.25, 0.13, 0.16], color: '#2b1d14' }, // beard
          { geo: hatChef(), pos: [0, 1.63 + y0, 0], scale: [1.05, 1.15, 1.05], color: '#ffffff' },
        );
      } else if (special === 'critic') {
        parts.push(
          { geo: boxG(), pos: [0, 0.66 + y0, 0], scale: [0.46, 0.42, 0.31], color: shirt }, // long coat
          { geo: boxG(), pos: [0, 1.06 + y0, 0.152], scale: [0.025, 0.7, 0.02], color: '#6e5230' }, // coat seam
          { geo: boxG(), pos: [0, 1.42 + y0, 0.02], scale: [0.36, 0.09, 0.3], color: '#b0302a' }, // scarf
          { geo: boxG(), pos: [0.1, 1.28 + y0, 0.155], scale: [0.07, 0.22, 0.02], color: '#b0302a' }, // scarf tail
          { geo: boxG(), pos: [-0.07, 1.6 + y0, 0.158], scale: [0.09, 0.07, 0.015], color: '#1a1a1a' }, // glasses
          { geo: boxG(), pos: [0.07, 1.6 + y0, 0.158], scale: [0.09, 0.07, 0.015], color: '#1a1a1a' },
          { geo: boxG(), pos: [0, 1.61 + y0, 0.158], scale: [0.05, 0.015, 0.015], color: '#1a1a1a' },
          { geo: cylinder(0.5, 0.5, 1, 14), pos: [0, 1.73 + y0, 0], scale: [0.5, 0.03, 0.5], color: '#3d4a3f' }, // hat brim
          { geo: cylinder(0.5, 0.46, 1, 12), pos: [0, 1.82 + y0, 0], scale: [0.31, 0.16, 0.31], color: '#3d4a3f' }, // crown
          { geo: cylinder(0.5, 0.5, 1, 12), pos: [0, 1.76 + y0, 0], scale: [0.315, 0.04, 0.315], color: '#b0302a' }, // band
        );
      } else if (role === 'cook') parts.push({ geo: hatChef(), pos: [0, 1.64 + y0, 0], color: '#ffffff' });
      else if (role === 'front') parts.push({ geo: capG(), pos: [0, 1.66 + y0, 0], color: '#c8352a' });
      else if (role === 'driver') parts.push({ geo: helmetG(), pos: [0, 1.6 + y0, 0], scale: [0.36, 0.34, 0.36], color: '#f2b33d' });
      else parts.push({ geo: hairG(), pos: [0, 1.6 + y0, -0.01], scale: [0.33, 0.33, 0.33], color: hairCol });
      return merge(parts);
    });
    this.chest.add(new Mesh(body, WHITE));
    // arms: upper arm from the shoulder, forearm from the elbow, a hand at the end
    const upperGeo = cached('pupper2|' + shirt, () => merge([{ geo: limb(), pos: [0, -0.12, 0], scale: [0.12, 0.26, 0.13], color: shirt }]));
    // short sleeves for the crew (forearms show), long ones for the inspector and critic
    const sleeve = special ? shirt : skin;
    const foreGeo = cached('pfore2|' + sleeve + '|' + skin, () =>
      merge([
        { geo: limb(), pos: [0, -0.1, 0], scale: [0.1, 0.22, 0.11], color: sleeve },
        { geo: ball(), pos: [0, -0.245, 0.01], scale: [0.1, 0.1, 0.1], color: skin },
      ]),
    );
    const mkArm = (x: number) => {
      const sh = new Node().at(x, 1.32 - 0.78, 0);
      const up = new Mesh(upperGeo, WHITE);
      const el = new Node().at(0, -0.25, 0);
      const fore = new Mesh(foreGeo, WHITE);
      el.add(fore);
      sh.add(up, el);
      this.chest.add(sh);
      return { sh, el, fore };
    };
    const L = mkArm(-0.29), R = mkArm(0.29);
    this.shL = L.sh;
    this.shR = R.sh;
    this.elL = L.el;
    this.elR = R.el;
    this.armL = L.fore;
    this.armR = R.fore;
    // things held in the right hand (hidden until needed)
    const hand = (m: Mesh, pos: V3, rot: V3 = [0, 0, 0]) => {
      m.position = pos;
      m.rotation = rot;
      m.visible = false;
      m.castShadow = false;
      this.elR.add(m);
      return m;
    };
    this.rag = hand(new Mesh(cached('rag', () => merge([{ geo: box(1, 1, 1), pos: [0, 0, 0], scale: [0.16, 0.03, 0.12], color: '#6fa8dc' }])), WHITE), [0, -0.28, 0.03]);
    this.peel = hand(new Mesh(cached('peel', () => merge([{ geo: box(1, 1, 1), pos: [0, 0, 0.35], scale: [0.04, 0.04, 0.7], color: '#8a5a35' }, { geo: cylinder(0.5, 0.5, 1, 12), pos: [0, 0, 0.8], scale: [0.4, 0.015, 0.4], color: '#b98a4e' }])), WHITE), [0, -0.26, 0.02], [0, 0, 0]);
    this.slice = hand(new Mesh(cached('handslice', () => merge([
      { geo: cylinder(0.5, 0.5, 1, 6, { thetaStart: -0.35, thetaLength: 0.7 }), pos: [0, 0, 0], scale: [0.36, 0.02, 0.36], color: '#d9a15a' },
      { geo: cylinder(0.5, 0.5, 1, 6, { thetaStart: -0.33, thetaLength: 0.66 }), pos: [0, 0.012, 0], scale: [0.32, 0.012, 0.32], color: '#f6c843' },
    ])), WHITE), [0, -0.29, 0.06], [Math.PI / 2, 0, 0]);
    if (role === 'front') {
      // a broom: sweeping replaces the old sliding mop
      this.tool = new Mesh(cached('broom', () => merge([{ geo: box(1, 1, 1), pos: [0, 0.62, 0], scale: [0.035, 1.25, 0.035], color: '#8a5a35' }, { geo: box(1, 1, 1), pos: [0, 0.02, 0], scale: [0.32, 0.07, 0.1], color: '#d9b36a' }, { geo: box(1, 1, 1), pos: [0, 0.06, 0], scale: [0.34, 0.03, 0.06], color: '#c8352a' }])), WHITE);
      this.tool.position = [0.3, 0.02, 0.32];
      this.tool.visible = false;
      B.add(this.tool);
    }
    if (special) {
      // clipboard for the inspector, a little notebook for the critic
      const geo = special === 'logan'
        ? cached('clipboard', () => merge([{ geo: box(1, 1, 1), pos: [0, 0, 0], scale: [0.26, 0.34, 0.02], color: '#b98a4e' }, { geo: box(1, 1, 1), pos: [0, 0.01, 0.012], scale: [0.22, 0.28, 0.01], color: '#ffffff' }, { geo: box(1, 1, 1), pos: [0, 0.16, 0.02], scale: [0.1, 0.04, 0.02], color: '#9a9a9a' }]))
        : cached('notebook', () => merge([{ geo: box(1, 1, 1), pos: [0, 0, 0], scale: [0.14, 0.19, 0.03], color: '#2b1d14' }, { geo: box(1, 1, 1), pos: [0, 0, 0.016], scale: [0.12, 0.17, 0.01], color: '#f4ead6' }]));
      this.tool = new Mesh(geo, WHITE);
      this.tool.position = special === 'logan' ? [-0.05, 1.02 - 0.78, 0.3] : [0.12, 1.0 - 0.78, 0.28];
      this.tool.rotation = [-0.5, 0, 0];
      this.chest.add(this.tool);
    }
    this.carry = new Mesh(cached('carrybox', () => merge(pizzaBox())), WHITE);
    this.carry.position = [0, 0.92 - 0.78, 0.34];
    this.carry.visible = false;
    this.chest.add(this.carry);
    this.plate = new Mesh(cached('carryplate', () => merge([...plate(), { geo: pizzaGeo(['#b53a2a']), pos: [0, 0.03, 0] }])), WHITE);
    this.plate.position = [0, 1.02 - 0.78, 0.36];
    this.plate.visible = false;
    this.chest.add(this.plate);
    this.bubble = new Sprite(moodTex('happy'), 0.55, 0.55);
    this.bubble.position = [0, 2.25, 0];
    this.bubble.visible = false;
    this.add(this.bubble);
    this.scale = [look.height, look.height, look.height];
  }

  setMood(m: 'happy' | 'ok' | 'angry' | 'none') {
    if (m === 'none') {
      this.bubble.visible = false;
      return;
    }
    this.bubble.visible = true;
    this.bubble.texture = moodTex(m);
  }

  goTo(path: [number, number][]) {
    this.path = path.slice();
  }

  /** The pose for whatever they're doing right now. */
  private targetPose(): Pose {
    const p = ZERO();
    const t = this.phase;
    const act: Action = this.sitting ? (this.action === 'eat' ? 'eat' : 'sit') : this.working ? (this.action === 'idle' ? 'make' : this.action) : this.action === 'order' || this.action === 'scribble' ? this.action : 'idle';
    const carrying = this.carry.visible || this.plate.visible;
    switch (act) {
      case 'sit':
        p.legL = p.legR = -1.45;
        p.shL = [-0.55, 0, 0.05];
        p.shR = [-0.55 + Math.sin(t * 0.6) * 0.08, 0, -0.05];
        p.elL = p.elR = 0.9;
        p.bodyY = -0.3;
        break;
      case 'eat': {
        // lift a slice, take a bite, set it down, chat a bit
        p.legL = p.legR = -1.45;
        p.bodyY = -0.3;
        const cyc = (t * 0.45) % (Math.PI * 2);
        const up = Math.max(0, Math.sin(cyc));
        p.shR = [-0.7 - up * 0.75, 0, -0.15];
        p.elR = 1.0 + up * 0.9;
        p.shL = [-0.55, 0, 0.05];
        p.elL = 0.95;
        p.lean = 0.08 + up * 0.06;
        break;
      }
      case 'make': {
        // both hands over the make line: spreading, sprinkling, placing
        const a = Math.sin(t * 3.1), b = Math.sin(t * 2.3 + 1.3);
        p.shL = [-0.85 + a * 0.12, 0, 0.12 + b * 0.05];
        p.shR = [-0.8 + b * 0.14, 0, -0.12 - a * 0.06];
        p.elL = 0.7 + Math.max(0, b) * 0.35;
        p.elR = 0.65 + Math.max(0, -a) * 0.45;
        p.lean = 0.12;
        p.bodyY = Math.abs(Math.sin(t)) * 0.01;
        break;
      }
      case 'oven': {
        // peel forward into the oven and back
        const push = (Math.sin(t * 1.8) + 1) / 2;
        p.shR = [-1.2 + push * 0.15, 0, -0.05];
        p.shL = [-1.05 + push * 0.15, 0, 0.2];
        p.elR = 0.25 - push * 0.2;
        p.elL = 0.6 - push * 0.3;
        p.lean = 0.1 + push * 0.12;
        p.legL = -0.15 * push;
        break;
      }
      case 'wipe': {
        // rag in little circles on the table
        const cx = Math.sin(t * 4), cz = Math.cos(t * 4);
        p.shR = [-1.0 + cz * 0.1, 0, -0.15 + cx * 0.12];
        p.elR = 0.5 + cz * 0.15;
        p.shL = [-0.3, 0, 0.1];
        p.elL = 0.6;
        p.lean = 0.35;
        break;
      }
      case 'sweep': {
        const sw = Math.sin(t * 2.4);
        p.shR = [-0.55, 0, -0.1 + sw * 0.18];
        p.shL = [-0.75, 0, 0.25 + sw * 0.15];
        p.elR = 0.6;
        p.elL = 0.9;
        p.twist = sw * 0.18;
        p.lean = 0.1;
        break;
      }
      case 'order': {
        // tapping the register
        p.shR = [-0.75, 0, -0.08];
        p.elR = 0.9 + Math.max(0, Math.sin(t * 7)) * 0.2;
        p.shL = [-0.6, 0, 0.1];
        p.elL = 0.85;
        p.lean = 0.05;
        break;
      }
      case 'scribble':
        p.shL = [-1.1, 0, 0.2];
        p.elL = 0.9;
        p.shR = [-0.95 + Math.sin(t * 3) * 0.1, 0, -0.25];
        p.elR = 1.1;
        break;
      default:
        // standing about: a slow breathing sway
        p.shL = [Math.sin(t * 0.5) * 0.05, 0, 0.1];
        p.shR = [-Math.sin(t * 0.5) * 0.05, 0, -0.1];
        p.elL = p.elR = 0.22;
        p.bodyY = Math.sin(t * 0.7) * 0.008;
    }
    if (this.special && act !== 'eat') {
      // hold the clipboard/notebook up
      p.shL = [-1.1, 0, 0.2];
      p.elL = 0.9;
      if (this.working || this.sitting) {
        p.shR = [-1.0 + Math.sin(t * 3) * 0.12, 0, -0.25];
        p.elR = 1.0;
      }
    }
    if (carrying) {
      p.shL = [-0.95, 0, 0.12];
      p.shR = [-0.95, 0, -0.12];
      p.elL = p.elR = 0.85;
    }
    return p;
  }

  /** speed: meters per real second. minPerSec: game minutes per real second (0 = frozen). */
  update(dt: number, speed: number, minPerSec = 2) {
    if (dt <= 0 || minPerSec <= 0) return;
    // stride follows actual speed so feet don't skate at high game speeds
    this.phase += dt * (this.walking ? Math.min(30, 2.6 * speed) : 3 * Math.min(2, minPerSec / 2));
    // movement along path
    this.walking = false;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.position[0], dz = tz - this.position[2];
      const d = Math.hypot(dx, dz);
      const step = speed * dt;
      if (d <= step || d < 0.02) {
        this.position = [tx, this.position[1], tz];
        this.path.shift();
      } else {
        this.position = [this.position[0] + (dx / d) * step, this.position[1], this.position[2] + (dz / d) * step];
        this.targetFacing = Math.atan2(dx, dz);
        this.walking = true;
      }
    }
    // turn smoothly
    let df = this.targetFacing - this.facing;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this.facing += df * Math.min(1, dt * 10);
    this.rotation = [0, this.facing, 0];
    // blend toward the pose for what they're doing (no more snapping between poses)
    const target = this.targetPose();
    const k = 1 - Math.exp(-dt * 12);
    const P = this.pose;
    const mix = (a: number, b: number) => a + (b - a) * k;
    P.legL = mix(P.legL, target.legL);
    P.legR = mix(P.legR, target.legR);
    for (let i = 0; i < 3; i++) {
      P.shL[i] = mix(P.shL[i], target.shL[i]);
      P.shR[i] = mix(P.shR[i], target.shR[i]);
    }
    P.elL = mix(P.elL, target.elL);
    P.elR = mix(P.elR, target.elR);
    P.bodyY = mix(P.bodyY, target.bodyY);
    P.lean = mix(P.lean, target.lean);
    P.twist = mix(P.twist, target.twist);
    // walking cycle layered on top, faded in and out
    this.walkBlend = mix(this.walkBlend, this.walking ? 1 : 0);
    const w = this.walkBlend;
    const sw = Math.sin(this.phase) * 0.6 * w;
    const legs = [this.legL.parent!, this.legR.parent!];
    const carrying = this.carry.visible || this.plate.visible;
    legs[0].rotation = [P.legL * (1 - w) + sw, 0, 0];
    legs[1].rotation = [P.legR * (1 - w) - sw, 0, 0];
    const armSw = carrying ? 0 : sw * 0.75;
    this.shL.rotation = [P.shL[0] * (1 - w * (carrying ? 0 : 1)) - armSw, P.shL[1], P.shL[2] + 0.05 * w];
    this.shR.rotation = [P.shR[0] * (1 - w * (carrying ? 0 : 1)) + armSw, P.shR[1], P.shR[2] - 0.05 * w];
    // elbows bend a little more on the back swing, like real arms
    this.elL.rotation = [-(P.elL * (1 - w) + (0.25 + Math.max(0, -sw) * 0.4) * w), 0, 0];
    this.elR.rotation = [-(P.elR * (1 - w) + (0.25 + Math.max(0, sw) * 0.4) * w), 0, 0];
    this.chest.rotation = [P.lean * (1 - w) + 0.04 * w, P.twist * (1 - w), 0];
    this.bodyGroup.position = [0, P.bodyY * (1 - w) + Math.abs(Math.cos(this.phase)) * 0.045 * w, 0];
    // what's in their hand
    const act = this.sitting ? this.action : this.working ? this.action : 'idle';
    const detail = PEOPLE_DETAIL.high;
    this.rag.visible = detail && act === 'wipe' && !this.walking;
    this.peel.visible = detail && act === 'oven' && !this.walking;
    this.slice.visible = detail && this.sitting && this.action === 'eat';
    if (this.tool && !this.special) {
      this.tool.visible = this.working && (act === 'sweep') && !this.walking;
      if (this.tool.visible) {
        const s2 = Math.sin(this.phase * 2.4);
        // bristles out in front sweeping side to side, handle leaning back into the hands
        this.tool.position = [0.12 + s2 * 0.22, 0.03, 0.72];
        this.tool.rotation = [-0.5, 0, s2 * 0.18];
      }
    }
    // bubble bob
    this.bubble.position = [0, 2.25 + Math.sin(this.phase * 0.8) * 0.04, 0];
  }

  get atDest() {
    return this.path.length === 0;
  }
}

export function lookFacing(from: V3, x: number, z: number) {
  return Math.atan2(x - from[0], z - from[2]);
}

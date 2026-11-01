// Pooled sprite particles: oven smoke, pizza steam, sale sparkles and celebration confetti.
import { Node, Sprite, Texture } from '../engine/scene';
import { hex, type V3 } from '../engine/math';

function tex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return new Texture(c, { repeat: false });
}

let puffT: Texture | null = null;
let sparkT: Texture | null = null;
let chipT: Texture | null = null;
function textures() {
  if (!puffT) {
    puffT = tex((g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0.95)');
      r.addColorStop(0.45, 'rgba(255,255,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
    sparkT = tex((g, s) => {
      const c = s / 2;
      const r = g.createRadialGradient(c, c, 0, c, c, c);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.2, 'rgba(255,255,255,0.6)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(c, 2); g.lineTo(c + 4, c - 4); g.lineTo(s - 2, c); g.lineTo(c + 4, c + 4);
      g.lineTo(c, s - 2); g.lineTo(c - 4, c + 4); g.lineTo(2, c); g.lineTo(c - 4, c - 4);
      g.closePath();
      g.fill();
    });
    chipT = tex((g, s) => {
      g.fillStyle = '#fff';
      g.fillRect(s * 0.2, s * 0.3, s * 0.6, s * 0.4);
    }, 32);
  }
  return { puff: puffT!, spark: sparkT!, chip: chipT! };
}

export type FxKind = 'smoke' | 'steam' | 'sparkle' | 'confetti' | 'puff';

interface Particle {
  s: Sprite;
  vel: V3;
  life: number;
  max: number;
  size0: number;
  size1: number;
  alpha: number;
  gravity: number;
  spinV: number;
  drag: number;
}

const CONFETTI = ['#c8352a', '#f2b33d', '#2f7a3b', '#2f6fd1', '#f6f1e6', '#e76f51'].map(hex);

export class Particles {
  root = new Node();
  private live: Particle[] = [];
  private pool: Sprite[] = [];
  max = 260;
  enabled = true;

  private take(): Sprite | null {
    if (this.live.length >= this.max) return null;
    const s = this.pool.pop() ?? new Sprite(textures().puff, 1, 1);
    this.root.add(s);
    return s;
  }

  emit(kind: FxKind, pos: V3, n = 1) {
    if (!this.enabled) return;
    const T = textures();
    for (let i = 0; i < n; i++) {
      const s = this.take();
      if (!s) return;
      const r = (a: number) => (Math.random() - 0.5) * a;
      const p: Particle = { s, vel: [0, 0, 0], life: 0, max: 1, size0: 0.3, size1: 0.6, alpha: 0.5, gravity: 0, spinV: 0, drag: 0 };
      s.spin = Math.random() * Math.PI * 2;
      s.glow = 0;
      s.position = [pos[0] + r(0.15), pos[1], pos[2] + r(0.15)];
      switch (kind) {
        case 'smoke': {
          s.texture = T.puff;
          const g = 0.42 + Math.random() * 0.15;
          s.tint = [g, g * 0.97, g * 0.95];
          p.vel = [r(0.25) + 0.12, 0.75 + Math.random() * 0.35, r(0.25)];
          p.max = 2.6 + Math.random() * 1.2;
          p.size0 = 0.35;
          p.size1 = 1.5;
          p.alpha = 0.42;
          p.spinV = r(0.6);
          p.drag = 0.15;
          break;
        }
        case 'steam':
          s.texture = T.puff;
          s.tint = [1, 1, 1];
          p.vel = [r(0.08), 0.32 + Math.random() * 0.2, r(0.08)];
          p.max = 1.4 + Math.random() * 0.6;
          p.size0 = 0.1;
          p.size1 = 0.42;
          p.alpha = 0.32;
          p.spinV = r(1);
          break;
        case 'puff':
          s.texture = T.puff;
          s.tint = [0.95, 0.93, 0.88];
          p.vel = [r(1.4), 0.4 + Math.random() * 0.6, r(1.4)];
          p.max = 0.7 + Math.random() * 0.3;
          p.size0 = 0.25;
          p.size1 = 0.9;
          p.alpha = 0.55;
          p.drag = 2.5;
          break;
        case 'sparkle':
          s.texture = T.spark;
          s.tint = hex(Math.random() < 0.7 ? '#ffd166' : '#fff3c4');
          s.glow = 1;
          p.vel = [r(1.6), 1.2 + Math.random() * 1.2, r(1.6)];
          p.max = 0.6 + Math.random() * 0.4;
          p.size0 = 0.32;
          p.size1 = 0.05;
          p.alpha = 1;
          p.gravity = -3.5;
          p.spinV = r(6);
          p.drag = 1.2;
          break;
        case 'confetti':
          s.texture = T.chip;
          s.tint = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
          s.glow = 0.15;
          p.vel = [r(5), 4 + Math.random() * 3.5, r(5)];
          p.max = 2.4 + Math.random() * 1.2;
          p.size0 = 0.22;
          p.size1 = 0.22;
          p.alpha = 1;
          p.gravity = -6;
          p.spinV = r(14);
          p.drag = 1.4;
          break;
      }
      s.width = s.height = p.size0;
      s.scale = [1, 1, 1];
      s.opacity = p.alpha;
      this.live.push(p);
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1 || p.s.position[1] < -0.2) {
        this.root.remove(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vel = [p.vel[0] * d, (p.vel[1] + p.gravity * dt) * (p.gravity ? d : 1), p.vel[2] * d];
      const q = p.s.position;
      p.s.position = [q[0] + p.vel[0] * dt, q[1] + p.vel[1] * dt, q[2] + p.vel[2] * dt];
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      p.s.width = p.s.height = size;
      p.s.spin += p.spinV * dt;
      // fade in quickly, out slowly
      const a = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      p.s.opacity = p.alpha * Math.max(0, a);
    }
  }

  clear() {
    for (const p of this.live) {
      this.root.remove(p.s);
      this.pool.push(p.s);
    }
    this.live = [];
  }
}

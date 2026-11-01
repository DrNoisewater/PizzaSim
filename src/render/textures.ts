// Procedural canvas textures (no image assets needed).
import { Texture } from '../engine/scene';

const cache = new Map<string, Texture>();
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function cached(key: string, make: () => Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}
function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, alpha: number, seed = 1) {
  let s = seed * 9301;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < amount; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

export const FONT_DISPLAY = "'Lilita One', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";
export const FONT_UI = "'Barlow', 'Segoe UI', system-ui, sans-serif";

/** Floor texture per decor level. One tile repeat = 2 m. */
export function floorTex(level: number): Texture {
  return cached('floor' + level, () => {
    const c = canvas(256, 256);
    const g = c.getContext('2d')!;
    if (level === 0) {
      g.fillStyle = '#a69d90';
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 256, 2600, 0.1, 3);
      // a few worn patches
      g.fillStyle = 'rgba(70,55,40,0.07)';
      g.beginPath(); g.ellipse(70, 90, 60, 34, 0.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(190, 190, 44, 26, -0.3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(60,55,50,0.25)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, 254, 254);
    } else if (level === 1) {
      g.fillStyle = '#d9d2c3';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#b9b09f';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
      }
      noise(g, 256, 256, 900, 0.06, 5);
    } else if (level === 2) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#1f1d1c' : '#f1ece2';
        g.fillRect(x * 64, y * 64, 64, 64);
      }
      noise(g, 256, 256, 800, 0.05, 7);
    } else if (level === 3) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#b8322a' : '#f3e6cf';
        g.fillRect(x * 64, y * 64, 64, 64);
      }
      noise(g, 256, 256, 800, 0.06, 9);
    } else {
      // oak planks
      const tones = ['#9c6a3e', '#a8744a', '#8f5f37', '#b17d50'];
      for (let row = 0; row < 8; row++) {
        let x = -((row * 53) % 120);
        while (x < 256) {
          const w = 90 + ((row * 37 + x) % 60);
          g.fillStyle = tones[(row + Math.floor(x / 40)) % tones.length];
          g.fillRect(x, row * 32, w, 32);
          g.fillStyle = 'rgba(40,20,5,0.18)';
          g.fillRect(x, row * 32, 2, 32);
          x += w;
        }
        g.fillStyle = 'rgba(40,20,5,0.4)';
        g.fillRect(0, row * 32, 256, 2);
      }
      noise(g, 256, 256, 1500, 0.08, 11);
    }
    return new Texture(c);
  });
}

export function kitchenFloorTex(): Texture {
  return cached('kfloor', () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = '#6f6a63';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#7c776f';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 16, y * 16, 16, 16);
    noise(g, 128, 128, 600, 0.08, 2);
    return new Texture(c);
  });
}

/** Wall texture per decor level (1 repeat = 2 m wide, full wall height). */
export function wallTex(level: number): Texture {
  return cached('wall' + level, () => {
    const c = canvas(256, 256);
    const g = c.getContext('2d')!;
    if (level === 0) {
      g.fillStyle = '#ddd4c4';
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 256, 1200, 0.05, 4);
      g.fillStyle = 'rgba(120,100,80,0.08)';
      g.fillRect(0, 200, 256, 56);
    } else if (level === 1) {
      g.fillStyle = '#f0ead9';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#6f9a6b';
      g.fillRect(0, 170, 256, 86);
      g.fillStyle = '#56805a';
      g.fillRect(0, 166, 256, 6);
    } else if (level === 2) {
      g.fillStyle = '#f4efe3';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#b8322a';
      g.fillRect(0, 150, 256, 10);
      g.fillStyle = '#1f6f45';
      g.fillRect(0, 162, 256, 4);
      // subway tile lower half
      g.fillStyle = '#ffffff';
      g.fillRect(0, 168, 256, 88);
      g.strokeStyle = '#d6d0c4';
      g.lineWidth = 2;
      for (let row = 0; row < 6; row++) {
        const y = 168 + row * 15;
        g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
        for (let x = (row % 2) * 16; x < 256; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 15); g.stroke(); }
      }
    } else if (level === 3) {
      // brick
      g.fillStyle = '#7d3326';
      g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 16; row++) {
        for (let x = (row % 2) * -16; x < 256; x += 32) {
          const t = 0.75 + ((row * 7 + x) % 13) / 40;
          g.fillStyle = `rgb(${Math.round(150 * t)},${Math.round(62 * t)},${Math.round(44 * t)})`;
          g.fillRect(x + 1, row * 16 + 1, 30, 14);
        }
      }
      noise(g, 256, 256, 1500, 0.1, 6);
    } else {
      // wood wainscot + warm plaster
      g.fillStyle = '#efe0c4';
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 140, 900, 0.04, 8);
      g.fillStyle = '#5a3a22';
      g.fillRect(0, 140, 256, 116);
      g.fillStyle = '#6d4730';
      for (let x = 8; x < 256; x += 64) g.fillRect(x, 156, 48, 84);
      g.fillStyle = '#3e2715';
      g.fillRect(0, 136, 256, 8);
    }
    return new Texture(c);
  });
}

export function awningTex(): Texture {
  return cached('awning', () => {
    const c = canvas(256, 64);
    const g = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f6f1e6' : '#c8352a';
      g.fillRect(i * 32, 0, 32, 64);
    }
    // scalloped edge shading
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 56, 256, 8);
    return new Texture(c);
  });
}

export function roadTex(): Texture {
  return cached('road', () => {
    const c = canvas(256, 256);
    const g = c.getContext('2d')!;
    g.fillStyle = '#3b3a3d';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 3000, 0.1, 12);
    g.fillStyle = '#e9c54a';
    g.fillRect(0, 124, 120, 8);
    return new Texture(c);
  });
}

export function sidewalkTex(): Texture {
  return cached('sidewalk', () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = '#bdb8ae';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#a19c92';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
    noise(g, 128, 128, 700, 0.08, 13);
    return new Texture(c);
  });
}

export function groundTex(kind: 'grass' | 'concrete' | 'wood' | 'tile'): Texture {
  return cached('ground' + kind, () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    if (kind === 'grass') {
      g.fillStyle = '#6f9d4f';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = Math.random() < 0.5 ? '#5f8d42' : '#82ad5c';
        g.fillRect(Math.random() * 128, Math.random() * 128, 2, 3);
      }
    } else if (kind === 'concrete') {
      g.fillStyle = '#8f8c86';
      g.fillRect(0, 0, 128, 128);
      noise(g, 128, 128, 1500, 0.12, 14);
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      g.strokeRect(0, 0, 128, 128);
    } else if (kind === 'wood') {
      g.fillStyle = '#9b7a55';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#8d6c48' : '#a6845d';
        g.fillRect(0, i * 16, 128, 15);
      }
      noise(g, 128, 128, 800, 0.1, 15);
    } else {
      g.fillStyle = '#d7d4cd';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#bfbab0';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 64, 64);
      g.strokeRect(64, 64, 64, 64);
      g.strokeRect(64, 0, 64, 64);
      g.strokeRect(0, 64, 64, 64);
    }
    return new Texture(c);
  });
}

export function waterTex(): Texture {
  return cached('water', () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f6f8f';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 10, 1.5);
    }
    return new Texture(c);
  });
}

/** Building facade with windows. lit = night lighting. */
export function facadeTex(base: string, lit: boolean): Texture {
  return cached('facade' + base + lit, () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    noise(g, 128, 128, 500, 0.08, 16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const on = lit && (x * 3 + y * 5) % 4 !== 0;
      g.fillStyle = on ? '#ffd889' : '#3d4a5a';
      g.fillRect(x * 32 + 8, y * 32 + 8, 16, 18);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      if (!on) g.fillRect(x * 32 + 8, y * 32 + 8, 16, 4);
    }
    return new Texture(c);
  });
}

/** Text label texture (signs, menu boards). */
export function textTex(lines: { text: string; size: number; color: string; font?: string }[], w: number, h: number, bg: string | null, pad = 12): Texture {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
  let y = (h - total) / 2 + pad * 0;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.size}px ${l.font ?? FONT_DISPLAY}`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y, w - pad * 2);
    y += l.size * 1.15;
  }
  return new Texture(c, { repeat: false });
}

/** Chalk menu board listing items and prices. */
export function menuBoardTex(items: { name: string; price: string }[], title: string): Texture {
  const c = canvas(512, 384);
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 0, 512, 384);
  g.fillStyle = '#23302a';
  g.fillRect(14, 14, 484, 356);
  noise(g, 512, 384, 1500, 0.05, 20);
  g.fillStyle = '#f2b33d';
  g.font = `44px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.fillText(title, 256, 66, 460);
  g.font = `600 26px ${FONT_UI}`;
  const show = items.slice(0, 9);
  show.forEach((it, i) => {
    const y = 112 + i * 29;
    g.textAlign = 'left';
    g.fillStyle = '#f4efe3';
    g.fillText(it.name, 40, y);
    g.textAlign = 'right';
    g.fillStyle = '#f2b33d';
    g.fillText(it.price, 472, y);
  });
  return new Texture(c, { repeat: false });
}

/** Simple framed art prints. */
export function artTex(kind: number): Texture {
  return cached('art' + kind, () => {
    const c = canvas(128, 160);
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b2118';
    g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#f4ead6';
    g.fillRect(10, 10, 108, 140);
    if (kind === 0) {
      // volcano at dusk
      g.fillStyle = '#f2b33d';
      g.fillRect(10, 10, 108, 80);
      g.fillStyle = '#e07a3a';
      g.beginPath(); g.arc(64, 60, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4b3b52';
      g.beginPath(); g.moveTo(10, 150); g.lineTo(52, 72); g.lineTo(76, 72); g.lineTo(118, 150); g.fill();
    } else if (kind === 1) {
      // tomato
      g.fillStyle = '#c8352a';
      g.beginPath(); g.arc(64, 86, 34, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3f9b4a';
      g.beginPath(); g.ellipse(64, 54, 16, 6, 0, 0, Math.PI * 2); g.fill();
    } else if (kind === 2) {
      // pizza slice
      g.fillStyle = '#e8b04a';
      g.beginPath(); g.moveTo(30, 40); g.lineTo(98, 40); g.lineTo(64, 130); g.fill();
      g.fillStyle = '#b53a2a';
      for (const [x, y] of [[50, 60], [76, 62], [64, 90]]) { g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#c99a62';
      g.fillRect(28, 34, 72, 10);
    } else {
      // olive branch
      g.strokeStyle = '#3e5a36';
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(30, 130); g.quadraticCurveTo(64, 80, 98, 30); g.stroke();
      g.fillStyle = '#6f8f4a';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(40 + i * 10, 112 - i * 15, 9, 4, -0.8, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#2b2724';
      g.beginPath(); g.arc(70, 64, 6, 0, Math.PI * 2); g.fill();
    }
    return new Texture(c, { repeat: false });
  });
}

/** Mood bubble above customers' heads. */
export function moodTex(mood: 'happy' | 'ok' | 'angry' | 'sale' | 'star'): Texture {
  return cached('mood' + mood, () => {
    const c = canvas(64, 64);
    const g = c.getContext('2d')!;
    const col = mood === 'happy' ? '#3f9b4a' : mood === 'ok' ? '#e3a21a' : mood === 'angry' ? '#d8402b' : '#f2b33d';
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(32, 28, 24, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(24, 48); g.lineTo(32, 62); g.lineTo(40, 48); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(32, 28, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.lineCap = 'round';
    if (mood === 'happy' || mood === 'ok' || mood === 'angry') {
      g.beginPath(); g.arc(25, 24, 2.6, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(39, 24, 2.6, 0, Math.PI * 2); g.fill();
      g.beginPath();
      if (mood === 'happy') g.arc(32, 30, 8, 0.2, Math.PI - 0.2);
      else if (mood === 'ok') { g.moveTo(25, 35); g.lineTo(39, 35); }
      else g.arc(32, 41, 8, Math.PI + 0.3, -0.3);
      g.stroke();
    }
    return new Texture(c, { repeat: false });
  });
}

/** Floating "+$12.50" text. */
export function floatTextTex(text: string, color: string, wide = false): Texture {
  const W = wide ? 512 : 256;
  const c = canvas(W, 72);
  const g = c.getContext('2d')!;
  g.font = `${wide ? 50 : 52}px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(30,20,15,0.85)';
  g.strokeText(text, W / 2, 38, W - 12);
  g.fillStyle = color;
  g.fillText(text, W / 2, 38, W - 12);
  return new Texture(c, { repeat: false });
}

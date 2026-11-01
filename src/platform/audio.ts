// Procedural sound effects and adaptive music (WebAudio, no assets).
type Sfx = 'cash' | 'ding' | 'levelup' | 'error' | 'click' | 'door' | 'goal' | 'open' | 'close';

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  enabled = true;
  musicOn = false;
  volume = 0.6;
  private last: Record<string, number> = {};
  private musicTimer: number | null = null;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // a gentle limiter so stacked sounds never clip (clipping crackles)
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.18;
      // round off the buzzy waves a little
      const soften = this.ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 4200;
      this.musicGain.connect(soften);
      soften.connect(this.master);
      if (this.musicOn) this.startMusic();
    } catch {
      this.ctx = null;
    }
  }

  /** Pause all sound while the game is hidden (phones throttle timers in the background). */
  setHidden(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => undefined);
    else this.ctx.resume().catch(() => undefined);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode, glide?: number) {
    const ctx = this.ctx!;
    // a note scheduled in the past would start mid-wave and click
    start = Math.max(start, ctx.currentTime + 0.01);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(dest ?? this.master!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  play(name: Sfx) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = name === 'cash' ? 0.22 : 0.08;
    if ((this.last[name] ?? -1) > now - gap) return;
    this.last[name] = now;
    switch (name) {
      case 'cash':
        this.tone(1568, now, 0.09, 'square', 0.05);
        this.tone(2093, now + 0.07, 0.22, 'square', 0.045);
        break;
      case 'ding':
        this.tone(1318, now, 0.5, 'sine', 0.12);
        this.tone(2637, now, 0.3, 'sine', 0.03);
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, now + i * 0.09, 0.3, 'triangle', 0.12));
        break;
      case 'goal':
        [784, 988, 1175].forEach((f, i) => this.tone(f, now + i * 0.07, 0.25, 'triangle', 0.1));
        break;
      case 'error':
        this.tone(180, now, 0.18, 'sawtooth', 0.06, undefined, 120);
        break;
      case 'click':
        this.tone(900, now, 0.04, 'triangle', 0.05);
        break;
      case 'door':
        this.tone(880, now, 0.25, 'sine', 0.05);
        this.tone(660, now + 0.12, 0.3, 'sine', 0.05);
        break;
      case 'open':
        [392, 523, 659].forEach((f, i) => this.tone(f, now + i * 0.11, 0.35, 'triangle', 0.1));
        break;
      case 'close':
        [659, 523, 392].forEach((f, i) => this.tone(f, now + i * 0.13, 0.4, 'triangle', 0.08));
        break;
    }
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  // ------------------------------------------------------------------ adaptive music
  // Several short procedural tracks. Calm ones rotate every couple of minutes; when the store
  // gets backed up the music crossfades into a rush track, and back once things calm down.
  // A percussion layer also fades in smoothly with how busy it is.

  private players: Player[] = [];
  private intensity = 0;
  private mood: 'calm' | 'rush' = 'calm';
  private moodSince = 0;
  private calmIdx = 0;
  private rushIdx = 0;
  private noise: AudioBuffer | null = null;
  /** Name of the track playing now (for the settings readout). */
  nowPlaying = '';

  /** 0 = quiet, 1 = slammed. Called a few times a second from the game loop. */
  setIntensity(x: number) {
    this.intensity += (Math.max(0, Math.min(1, x)) - this.intensity) * 0.15;
    if (!this.ctx || this.musicTimer === null) return;
    const t = this.ctx.currentTime;
    const want = this.mood === 'calm' ? (this.intensity > 0.62 ? 'rush' : 'calm') : this.intensity < 0.3 ? 'calm' : 'rush';
    // hold a mood for a while so it doesn't flip-flop
    if (want !== this.mood && t - this.moodSince > (want === 'rush' ? 6 : 14)) {
      this.mood = want;
      this.moodSince = t;
      if (want === 'rush') this.switchTo(RUSH[this.rushIdx++ % RUSH.length], 2.5);
      else this.switchTo(CALM[this.calmIdx++ % CALM.length], 5);
    }
  }

  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.mood = 'calm';
    this.moodSince = this.ctx.currentTime;
    this.switchTo(CALM[this.calmIdx++ % CALM.length], 1.5);
    this.musicTimer = window.setInterval(() => this.tickMusic(), 60);
  }
  private stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) for (const p of this.players) p.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3);
    this.players = [];
  }

  private switchTo(track: Track, fade: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const t = ctx.currentTime;
    for (const p of this.players) {
      const gp = p.gain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
      // hold wherever the fade currently is (reading .value mid-ramp can jump and pop)
      if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(t);
      else {
        gp.cancelScheduledValues(t);
        gp.setValueAtTime(gp.value, t);
      }
      gp.linearRampToValueAtTime(0.0001, t + fade);
      p.endAt = t + fade + 0.2;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.connect(this.musicGain);
    const perc = ctx.createGain();
    perc.gain.value = 0;
    perc.connect(g);
    this.players.push({ track, gain: g, perc, next: t + 0.1, step: 0, started: t, endAt: Infinity });
    this.nowPlaying = track.name;
  }

  private tickMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.players = this.players.filter((p) => {
      if (t > p.endAt + 0.3) {
        p.gain.disconnect();
        return false;
      }
      return true;
    });
    // calm tracks rotate every couple of minutes so no loop wears thin
    const cur = this.players[this.players.length - 1];
    if (cur && cur.endAt === Infinity && this.mood === 'calm' && t - cur.started > 120) this.switchTo(CALM[this.calmIdx++ % CALM.length], 6);
    for (const p of this.players) {
      // percussion follows intensity (rush tracks always have some)
      const target = p.track.rush ? 0.55 + this.intensity * 0.45 : Math.max(0, (this.intensity - 0.25) * 1.2);
      p.perc.gain.setTargetAtTime(Math.min(1, target), t, 1.5);
      if (p.next < t + 0.02) {
        const missed = Math.ceil((t + 0.02 - p.next) / p.track.beat);
        p.step += missed;
        p.next += missed * p.track.beat;
      }
      while (p.next < t + 0.5) {
        p.track.play(this, p.step, p.next, p.gain, p.perc);
        p.next += p.track.beat;
        p.step++;
      }
    }
  }

  /** Musical note helpers for tracks. */
  note(freq: number, at: number, dur: number, type: OscillatorType, gain: number, out: AudioNode) {
    this.tone(freq, at, dur, type, gain, out);
  }
  hit(kind: 'hat' | 'snare' | 'kick', at: number, gain: number, out: AudioNode) {
    const ctx = this.ctx!;
    if (kind === 'kick') {
      this.tone(110, at, 0.18, 'sine', gain * 1.4, out, 45);
      return;
    }
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    at = Math.max(at, ctx.currentTime + 0.01);
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.05 : 0.14;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

interface Player {
  track: Track;
  gain: GainNode;
  perc: GainNode;
  next: number;
  step: number;
  started: number;
  endAt: number;
}
interface Track {
  name: string;
  rush: boolean;
  /** Seconds per step. */
  beat: number;
  play(a: AudioEngine, step: number, at: number, out: AudioNode, perc: AudioNode): void;
}

// note frequencies
const N = (n: string) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n)!;
  const semis: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  let s = semis[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, s / 12);
};
const chord = (...ns: string[]) => ns.map(N);

/** Arpeggio track helper: chords per bar, an arpeggio pattern, bass on the downbeat. */
function arpTrack(name: string, beat: number, perBar: number, chords: number[][], pattern: number[], opts: { wave?: OscillatorType; lead?: (number | null)[]; leadWave?: OscillatorType; rush?: boolean; swing?: boolean; drums?: (bar: number, i: number) => ('kick' | 'snare' | 'hat' | null)[] } = {}): Track {
  return {
    name,
    rush: !!opts.rush,
    beat,
    play(a, step, at, out, perc) {
      const bar = Math.floor(step / perBar) % chords.length;
      const i = step % perBar;
      const ch = chords[bar];
      const when = opts.swing && i % 2 === 1 ? at + beat * 0.18 : at;
      const p = pattern[i % pattern.length];
      if (p >= 0) a.note(ch[p % ch.length] * (p >= ch.length ? 2 : 1), when, beat * 1.05, opts.wave ?? 'triangle', 0.2, out);
      if (i === 0) a.note(ch[0] / 2, at, beat * perBar * 0.6, 'sine', 0.28, out);
      if (opts.lead) {
        const l = opts.lead[(Math.floor(step / perBar) * perBar + i) % opts.lead.length];
        if (l) a.note(l, when, beat * 1.6, opts.leadWave ?? 'square', 0.06, out);
      }
      if (opts.drums) {
        for (const d of opts.drums(bar, i)) if (d) a.hit(d, at, d === 'hat' ? 0.12 : d === 'snare' ? 0.16 : 0.3, perc);
      } else if (i % (perBar / 2) === 0) a.hit(i === 0 ? 'kick' : 'snare', at, 0.18, perc);
    },
  };
}

const CALM: Track[] = [
  // the original: a minor tarantella in 6/8
  arpTrack('Tarantella della Pizza', 0.16, 12, [chord('A3', 'C4', 'E4'), chord('D3', 'F3', 'A3'), chord('E3', 'G#3', 'B3'), chord('A3', 'C4', 'E4')], [0, 1, 2, 1, 2, 1, 3, 4, 5, 4, 5, 4]),
  // a lazy waltz on the mandolin
  arpTrack('Mandolin Morning', 0.19, 6, [chord('F3', 'A3', 'C4'), chord('D3', 'F3', 'A3'), chord('Bb2', 'D3', 'F3'), chord('C3', 'E3', 'G3')], [0, 1, 2, 3, 2, 1], { wave: 'triangle', lead: [N('C5'), null, N('A4'), null, N('F4'), null, N('D5'), null, N('C5'), null, N('A4'), null, N('Bb4'), null, N('D5'), null, N('F5'), null, N('E5'), null, N('C5'), null, N('G4'), null] }),
  // walking through the square
  arpTrack('Piazza Stroll', 0.2, 8, [chord('C3', 'E3', 'G3'), chord('A2', 'C3', 'E3'), chord('D3', 'F3', 'A3'), chord('G2', 'B2', 'D3')], [0, 2, 1, 2, 3, 2, 1, 2], { swing: true, wave: 'sine', lead: [N('E5'), null, N('G5'), null, N('E5'), N('D5'), N('C5'), null] }),
  // after hours: soft and slow
  arpTrack('Late Night Slice', 0.24, 8, [chord('D3', 'F3', 'A3', 'C4'), chord('G2', 'Bb2', 'D3', 'F3'), chord('C3', 'E3', 'G3', 'Bb3'), chord('A2', 'C#3', 'E3', 'G3')], [0, 2, 3, 1, 2, 3, 1, 2], { wave: 'sine' }),
];
const RUSH: Track[] = [
  // the dinner rush: fast tarantella in E minor with a snare
  arpTrack('Dinner Rush', 0.115, 12, [chord('E3', 'G3', 'B3'), chord('A3', 'C4', 'E4'), chord('B2', 'D#3', 'F#3'), chord('E3', 'G3', 'B3')], [0, 1, 2, 1, 2, 1, 3, 4, 5, 4, 5, 4], {
    wave: 'square',
    drums: (_b, i) => [i === 0 || i === 6 ? 'kick' : null, i === 3 || i === 9 ? 'snare' : null, i % 2 === 0 ? 'hat' : null],
  }),
  // driving ostinato when it's all hands on deck
  arpTrack('Order Overflow', 0.125, 8, [chord('A2', 'C3', 'E3'), chord('F2', 'A2', 'C3'), chord('G2', 'B2', 'D3'), chord('E2', 'G#2', 'B2')], [0, 0, 2, 0, 1, 0, 2, 3], {
    wave: 'sawtooth',
    lead: [N('A4'), null, N('C5'), N('E5'), null, N('D5'), N('C5'), null, N('F4'), null, N('A4'), N('C5'), null, N('B4'), N('A4'), null],
    leadWave: 'square',
    drums: (_b, i) => [i % 4 === 0 ? 'kick' : null, i % 4 === 2 ? 'snare' : null, 'hat'],
  }),
];

export const audio = new AudioEngine();

/**
 * 天阙 sound engine: everything is synthesised with Web Audio (no files to load).
 * Blades, metal, impacts, cloth whooshes, gongs and taiko, plus per-map ambience
 * and a generative guzheng score in D minor pentatonic.
 */

export type AmbienceId = 'temple' | 'lavacliff' | 'sea' | 'none';

interface Bus {
  ctx: AudioContext;
  out: AudioNode; // dry sfx bus
  verb: AudioNode; // reverb send
  now: number;
}

const PENTA = [0, 3, 5, 7, 10]; // D minor pentatonic: D F G A C
const D3 = 146.83;

export class WuxiaSound {
  ctx: AudioContext | null = null;
  private sfxIn!: GainNode;
  private verbIn!: GainNode;
  private ambIn!: GainNode;
  private musicIn!: GainNode;
  private noise!: AudioBuffer;
  private pinkNoise!: AudioBuffer;
  private ambNodes: { stop: () => void } | null = null;
  private ambTimer: number | null = null;
  private musicTimer: number | null = null;
  private musicNext = 0;
  private musicStep = 0;
  private musicPhrase: number[] = [];
  private drone: { stop: () => void } | null = null;
  private pluckCache = new Map<string, AudioBuffer>();
  musicOn = false;

  /** Hook the engine into an existing context and destination (the game's master gain) */
  attach(ctx: AudioContext, sfxDest: AudioNode, master: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    // master chain: limiter so stacked hits never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(sfxDest);

    this.sfxIn = ctx.createGain();
    this.sfxIn.gain.value = 0.9;
    this.sfxIn.connect(comp);

    // shared hall reverb (generated impulse)
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(2.6, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.verbIn = ctx.createGain();
    this.verbIn.connect(conv);
    conv.connect(wet);
    wet.connect(comp);

    // ambience and music bypass the sfx mute but share the master volume
    this.ambIn = ctx.createGain();
    this.ambIn.gain.value = 0.5;
    this.ambIn.connect(sfxDest); // ambience mutes with the sound effects
    this.musicIn = ctx.createGain();
    this.musicIn.gain.value = 0;
    const musicVerb = ctx.createGain();
    musicVerb.gain.value = 0.5;
    this.musicIn.connect(master);
    this.musicIn.connect(musicVerb);
    musicVerb.connect(conv);

    this.noise = this.makeNoise(2, false);
    this.pinkNoise = this.makeNoise(4, true);
  }

  private makeNoise(seconds: number, pink: boolean) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) d[i] = w;
      else {
        b0 = 0.997 * b0 + w * 0.029591;
        b1 = 0.985 * b1 + w * 0.032534;
        b2 = 0.95 * b2 + w * 0.048056;
        d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
      }
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private bus(): Bus | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return { ctx, out: this.sfxIn, verb: this.verbIn, now: ctx.currentTime };
  }

  private v(a = 0.06) {
    return 1 + (Math.random() * 2 - 1) * a;
  }

  // ------------------------------------------------------------------
  // building blocks
  // ------------------------------------------------------------------
  /** Band-passed noise sweep: blade and cloth whooshes */
  private whoosh(b: Bus, at: number, dur: number, f0: number, f1: number, gain: number, q = 1.2, verb = 0.15) {
    gain *= 1.8; // band-passed noise reads quieter than tonal hits
    const src = b.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.v(0.1);
    const bp = b.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, at);
    bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g);
    g.connect(b.out);
    if (verb > 0) {
      const s = b.ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(b.verb);
    }
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  /** Inharmonic struck metal (blade on blade, gongs, bells) */
  private metal(b: Bus, at: number, base: number, gain: number, decay: number, ratios = [1, 2.76, 5.4, 8.93], verb = 0.35) {
    const g = b.ctx.createGain();
    g.gain.value = 1;
    g.connect(b.out);
    if (verb > 0) {
      const s = b.ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(b.verb);
    }
    ratios.forEach((r, i) => {
      const o = b.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * r * this.v(0.01);
      const e = b.ctx.createGain();
      const amp = gain / (1 + i * 0.7);
      const d = decay / (1 + i * 0.45);
      e.gain.setValueAtTime(0.0001, at);
      e.gain.exponentialRampToValueAtTime(amp, at + 0.003);
      e.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(e).connect(g);
      o.start(at);
      o.stop(at + d + 0.05);
    });
  }

  /** Short filtered noise burst */
  private burst(b: Bus, at: number, dur: number, type: BiquadFilterType, freq: number, gain: number, verb = 0) {
    const src = b.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = b.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g);
    g.connect(b.out);
    if (verb > 0) {
      const s = b.ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(b.verb);
    }
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  /** Pitched thump: body hits, drums, explosions */
  private thump(b: Bus, at: number, f0: number, f1: number, dur: number, gain: number, verb = 0.1) {
    const o = b.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(b.out);
    if (verb > 0) {
      const s = b.ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(b.verb);
    }
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  // ------------------------------------------------------------------
  // combat sounds
  // ------------------------------------------------------------------
  swingLight() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.2, 2400 * this.v(), 700, 0.5, 1.6);
  }
  swingHeavy() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.38, 1300 * this.v(), 260, 0.75, 1.0, 0.25);
    this.whoosh(b, b.now + 0.04, 0.3, 3200, 900, 0.18, 2.5, 0);
  }
  kick() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.22, 900, 300, 0.5, 1.0);
    this.whoosh(b, b.now + 0.1, 0.16, 3000, 1200, 0.3, 2.2); // the short knife
  }
  whirl() {
    const b = this.bus();
    if (!b) return;
    for (let k = 0; k < 6; k++) this.whoosh(b, b.now + k * 0.14, 0.2, 1800, 500, 0.4, 1.4, 0.1);
  }
  charge() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.55, 300, 1200, 0.6, 0.8, 0.2);
    this.thump(b, b.now, 70, 40, 0.4, 0.5);
  }
  /** Flesh / armour hit */
  hitLight() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 170 * this.v(), 60, 0.16, 0.7, 0.05);
    this.burst(b, b.now, 0.08, 'bandpass', 1800, 0.35);
    this.burst(b, b.now, 0.12, 'lowpass', 700, 0.4);
  }
  hitHeavy() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 120 * this.v(), 38, 0.38, 1.0, 0.2);
    this.burst(b, b.now, 0.18, 'lowpass', 1200, 0.7, 0.2);
    this.metal(b, b.now, 420 * this.v(0.08), 0.12, 0.5, [1, 2.76, 5.4], 0.2);
  }
  /** Blades meeting on a block */
  clash() {
    const b = this.bus();
    if (!b) return;
    this.metal(b, b.now, 980 * this.v(0.08), 0.32, 0.9, [1, 2.76, 5.4, 8.93, 13.3], 0.4);
    this.burst(b, b.now, 0.05, 'highpass', 4000, 0.5);
  }
  perfect() {
    const b = this.bus();
    if (!b) return;
    this.metal(b, b.now, 1320, 0.42, 1.6, [1, 2.0, 2.76, 5.4, 8.93], 0.6);
    this.burst(b, b.now, 0.06, 'highpass', 5000, 0.6);
    this.thump(b, b.now, 200, 80, 0.2, 0.4);
  }
  /** Small dart leaving the hand: a sharp "shing" */
  throwDart() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.14, 5200 * this.v(0.1), 2600, 0.35, 3, 0.05);
    this.metal(b, b.now, 2600 * this.v(0.05), 0.05, 0.25, [1, 2.4], 0.1);
  }
  throwFan() {
    const b = this.bus();
    if (!b) return;
    for (let k = 0; k < 3; k++) this.whoosh(b, b.now + k * 0.03, 0.16, 5000 - k * 600, 2200, 0.3, 3, 0.05);
    this.metal(b, b.now, 2300, 0.07, 0.3, [1, 2.4], 0.1);
  }
  throwHeavy() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.32, 1600, 500, 0.6, 1.2, 0.2);
    this.metal(b, b.now, 900, 0.06, 0.4, [1, 2.76], 0.2);
  }
  dartHit() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 260 * this.v(), 110, 0.08, 0.55);
    this.burst(b, b.now, 0.05, 'bandpass', 2600, 0.4);
  }
  dartStick() {
    const b = this.bus();
    if (!b) return;
    this.burst(b, b.now, 0.035, 'bandpass', 3200 * this.v(0.2), 0.22);
    this.metal(b, b.now, 1900 * this.v(0.1), 0.03, 0.18, [1, 2.7], 0);
  }
  dodge() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.3, 700, 2200, 0.45, 0.9); // cloth rush
    this.burst(b, b.now + 0.18, 0.12, 'lowpass', 500, 0.2);
  }
  jump() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.22, 500, 1500, 0.3, 0.8, 0);
  }
  land() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 90, 45, 0.12, 0.35, 0);
    this.burst(b, b.now, 0.08, 'lowpass', 600, 0.2);
  }
  step() {
    const b = this.bus();
    if (!b) return;
    this.burst(b, b.now, 0.05, 'bandpass', 900 * this.v(0.2), 0.07);
  }
  /** Ground slam / 裂地斩 */
  slam() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 95, 30, 0.7, 1.0, 0.3);
    this.burst(b, b.now, 0.5, 'lowpass', 900, 0.8, 0.3);
    this.burst(b, b.now + 0.05, 0.35, 'bandpass', 2400, 0.25); // rock debris
    for (let k = 0; k < 5; k++) this.burst(b, b.now + 0.12 + Math.random() * 0.4, 0.04, 'bandpass', 1800 + Math.random() * 2000, 0.12);
  }
  /** Distant or map explosion (vents, volcano bombs, wall splats) */
  boom() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 70, 26, 0.9, 0.85, 0.4);
    this.burst(b, b.now, 0.8, 'lowpass', 600, 0.7, 0.4);
  }
  rage() {
    const b = this.bus();
    if (!b) return;
    this.taiko(b, b.now, 1);
    this.taiko(b, b.now + 0.18, 0.8);
    this.whoosh(b, b.now, 0.9, 200, 900, 0.5, 0.6, 0.3); // roar of flame
  }
  poison() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.7, 6000, 3000, 0.25, 4, 0.1); // hiss
    for (let k = 0; k < 4; k++) this.thump(b, b.now + 0.1 + k * 0.09, 420 + k * 70, 300, 0.08, 0.12, 0.1); // bubbles
  }
  /** Ultimate wind-up */
  ultRise() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 0.8, 200, 2400, 0.7, 0.7, 0.4);
    this.metal(b, b.now, 220, 0.18, 1.8, [1, 1.47, 2.06, 2.83], 0.6);
  }
  ultImpact() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 80, 22, 1.4, 1.0, 0.5);
    this.burst(b, b.now, 1.2, 'lowpass', 1400, 0.9, 0.6);
    this.gongAt(b, b.now + 0.02, 0.5);
  }
  private taiko(b: Bus, at: number, gain: number) {
    this.thump(b, at, 110, 52, 0.55, gain, 0.35);
    this.burst(b, at, 0.06, 'bandpass', 700, gain * 0.35, 0.2);
  }
  private gongAt(b: Bus, at: number, gain: number) {
    this.metal(b, at, 98, gain, 4.5, [1, 1.47, 2.06, 2.83, 3.6, 4.4], 0.8);
  }
  /** Round won/lost */
  gong() {
    const b = this.bus();
    if (!b) return;
    this.gongAt(b, b.now, 0.55);
    this.taiko(b, b.now, 0.9);
  }
  /** UI tick: woodblock */
  wood() {
    const b = this.bus();
    if (!b) return;
    this.thump(b, b.now, 900, 700, 0.06, 0.25, 0.05);
  }
  chime() {
    const b = this.bus();
    if (!b) return;
    this.metal(b, b.now, 1760, 0.1, 1.4, [1, 2.0, 3.01], 0.5);
    this.metal(b, b.now + 0.12, 2350, 0.07, 1.2, [1, 2.0], 0.5);
  }
  thunder() {
    const b = this.bus();
    if (!b) return;
    const src = b.ctx.createBufferSource();
    src.buffer = this.pinkNoise;
    const lp = b.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, b.now);
    lp.frequency.exponentialRampToValueAtTime(140, b.now + 3);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0.0001, b.now);
    g.gain.exponentialRampToValueAtTime(1.0, b.now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.35, b.now + 0.5);
    g.gain.linearRampToValueAtTime(0.45, b.now + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, b.now + 3.4);
    src.connect(lp).connect(g);
    g.connect(b.out);
    const s = b.ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(b.verb);
    src.start(b.now, Math.random(), 3.5);
  }
  waveCrash() {
    const b = this.bus();
    if (!b) return;
    this.whoosh(b, b.now, 1.6, 300, 2500, 0.9, 0.5, 0.4);
    this.burst(b, b.now + 0.5, 1.2, 'lowpass', 900, 0.6, 0.3);
  }

  // ------------------------------------------------------------------
  // ambience
  // ------------------------------------------------------------------
  setAmbience(id: AmbienceId) {
    if (!this.ctx) return;
    this.ambNodes?.stop();
    this.ambNodes = null;
    if (this.ambTimer) window.clearInterval(this.ambTimer);
    this.ambTimer = null;
    if (id === 'none') return;
    const ctx = this.ctx;
    const nodes: AudioScheduledSourceNode[] = [];
    const loopNoise = (buf: AudioBuffer, filter: BiquadFilterType, freq: number, q: number, gain: number, lfoRate = 0, lfoDepth = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(this.ambIn);
      if (lfoRate > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const d = ctx.createGain();
        d.gain.value = lfoDepth;
        lfo.connect(d).connect(g.gain);
        const d2 = ctx.createGain();
        d2.gain.value = freq * 0.5;
        lfo.connect(d2).connect(f.frequency);
        lfo.start();
        nodes.push(lfo);
      }
      src.start(0, Math.random() * 2);
      nodes.push(src);
    };
    const ambBus = (): Bus => ({ ctx, out: this.ambIn, verb: this.verbIn, now: ctx.currentTime });
    if (id === 'temple') {
      // mountain wind with slow gusts; now and then a wind bell
      loopNoise(this.pinkNoise, 'bandpass', 420, 0.7, 0.35, 0.07, 0.25);
      loopNoise(this.pinkNoise, 'highpass', 2500, 0.5, 0.04, 0.11, 0.03);
      this.ambTimer = window.setInterval(() => {
        if (Math.random() < 0.35) {
          const b = ambBus();
          this.metal(b, b.now, 2093 * (Math.random() < 0.5 ? 1 : 1.189), 0.05, 2.2, [1, 2.0, 3.01], 0.7);
        }
      }, 2500);
    } else if (id === 'lavacliff') {
      // deep magma rumble, crackling rock, popping bubbles
      loopNoise(this.pinkNoise, 'lowpass', 110, 0.7, 0.9, 0.05, 0.3);
      loopNoise(this.noise, 'bandpass', 2500, 0.8, 0.012);
      this.ambTimer = window.setInterval(() => {
        const b = ambBus();
        for (let k = 0; k < 3; k++) if (Math.random() < 0.6) this.burst(b, b.now + Math.random() * 0.4, 0.02, 'bandpass', 1500 + Math.random() * 3000, 0.08 + Math.random() * 0.1);
        if (Math.random() < 0.4) this.thump(b, b.now + Math.random() * 0.3, 140 + Math.random() * 120, 60, 0.15, 0.15, 0.1);
      }, 400);
    } else if (id === 'sea') {
      // rain hiss, swelling waves, creaking hull
      loopNoise(this.noise, 'highpass', 1800, 0.5, 0.09);
      loopNoise(this.noise, 'bandpass', 5000, 0.6, 0.05);
      loopNoise(this.pinkNoise, 'lowpass', 380, 0.6, 0.55, 0.09, 0.35);
      this.ambTimer = window.setInterval(() => {
        if (Math.random() < 0.3) {
          const b = ambBus();
          // wooden creak: a slow, rough low tone
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(70 + Math.random() * 30, b.now);
          o.frequency.linearRampToValueAtTime(55 + Math.random() * 20, b.now + 0.7);
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 400;
          f.Q.value = 4;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, b.now);
          g.gain.exponentialRampToValueAtTime(0.05, b.now + 0.2);
          g.gain.exponentialRampToValueAtTime(0.0001, b.now + 0.8);
          o.connect(f).connect(g).connect(this.ambIn);
          o.start(b.now);
          o.stop(b.now + 0.9);
        }
      }, 1500);
    }
    this.ambNodes = {
      stop: () =>
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        }),
    };
  }

  // ------------------------------------------------------------------
  // generative score: guzheng plucks over a drone, taiko on the downbeats
  // ------------------------------------------------------------------
  private pluckBuffer(freq: number) {
    const key = freq.toFixed(1);
    const hit = this.pluckCache.get(key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.4);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Karplus-Strong plucked string
    const N = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nxt = (idx + 1) % N;
      const val = (ring[idx] + ring[nxt]) * 0.5 * 0.996;
      d[i] = ring[idx];
      ring[idx] = val;
      idx = nxt;
    }
    this.pluckCache.set(key, buf);
    return buf;
  }

  private note(deg: number, oct: number) {
    const o = Math.floor(deg / 5);
    const s = PENTA[((deg % 5) + 5) % 5] + 12 * (o + oct);
    return D3 * Math.pow(2, s / 12);
  }

  private pluck(at: number, freq: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.3);
    src.connect(lp).connect(g).connect(this.musicIn);
    src.start(at);
    src.stop(at + 2.4);
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const ctx = this.ctx;
    this.musicIn.gain.cancelScheduledValues(ctx.currentTime);
    this.musicIn.gain.setTargetAtTime(0.22, ctx.currentTime, 0.8);
    // drone: D2 + A2, gently breathing
    const oscs = [73.42, 110].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i ? 0.05 : 0.09;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08 + i * 0.05;
      const d = ctx.createGain();
      d.gain.value = 0.03;
      lfo.connect(d).connect(g.gain);
      o.connect(g).connect(this.musicIn);
      o.start();
      lfo.start();
      return [o, lfo];
    });
    this.drone = { stop: () => oscs.flat().forEach((o) => o.stop()) };
    this.musicNext = ctx.currentTime + 0.1;
    this.musicStep = 0;
    const beat = 60 / 84 / 2; // eighth notes at 84 bpm
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx) return;
      while (this.musicNext < this.ctx.currentTime + 0.25) this.scheduleStep(this.musicNext, beat), (this.musicNext += beat), this.musicStep++;
    }, 60);
  }

  private scheduleStep(at: number, beat: number) {
    const step = this.musicStep % 32;
    if (step === 0) {
      // new 4-bar phrase: a gentle random walk on the scale, with rests
      let deg = 5 + Math.floor(Math.random() * 3);
      this.musicPhrase = [];
      for (let i = 0; i < 32; i++) {
        if (Math.random() < 0.42 || i % 8 === 7) this.musicPhrase.push(-99);
        else {
          deg += Math.round((Math.random() - 0.5) * 3);
          deg = Math.max(2, Math.min(12, deg));
          this.musicPhrase.push(deg);
        }
      }
    }
    const deg = this.musicPhrase[step];
    if (deg !== undefined && deg > -50) {
      const f = this.note(deg, 0);
      this.pluck(at, f, 0.32);
      // occasional grace note / octave doubling, guzheng style
      if (Math.random() < 0.15) this.pluck(at + beat * 0.5, this.note(deg + 1, 0), 0.18);
      if (step % 8 === 0) this.pluck(at, f / 2, 0.22);
    }
    // taiko: downbeat of every bar, a pickup before the phrase repeats
    const b: Bus = { ctx: this.ctx!, out: this.musicIn, verb: this.verbIn, now: at };
    if (step % 8 === 0) this.taiko(b, at, 0.55);
    if (step === 30) this.taiko(b, at, 0.35);
    if (step === 31) this.taiko(b, at, 0.45);
  }

  stopMusic() {
    if (!this.ctx || !this.musicOn) return;
    this.musicOn = false;
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    const ctx = this.ctx;
    this.musicIn.gain.cancelScheduledValues(ctx.currentTime);
    this.musicIn.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const d = this.drone;
    this.drone = null;
    window.setTimeout(() => d?.stop(), 2000);
  }
}

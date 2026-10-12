/**
 * 天阙 sound engine: everything is synthesised with Web Audio (no files to load).
 * Blades, metal, impacts, cloth whooshes, gongs and taiko, plus per-map ambience
 * and a generative guzheng score in D minor pentatonic.
 */

export type AmbienceId = 'temple' | 'lavacliff' | 'sea' | 'glacier' | 'rooftop' | 'summit' | 'forest' | 'none';

interface Bus {
  ctx: AudioContext;
  out: AudioNode; // dry sfx bus
  verb: AudioNode; // reverb send
  now: number;
}


export class WuxiaSound {
  ctx: AudioContext | null = null;
  private sfxIn!: GainNode;
  private verbIn!: GainNode;
  private ambIn!: GainNode;
  private musicVol!: GainNode;
  private vol = { sfx: 0.9, music: 0.8, amb: 0.8 };
  private musicIn!: GainNode;
  private noise!: AudioBuffer;
  private pinkNoise!: AudioBuffer;
  private ambNodes: { stop: () => void } | null = null;
  private ambTimer: number | null = null;
  private musicTimer: number | null = null;
  private musicNext = 0;
  private musicStep = 0;
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
    this.sfxIn.gain.value = this.vol.sfx;
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
    this.ambIn.gain.value = 0.5 * (this.vol.amb / 0.8);
    this.ambIn.connect(sfxDest); // ambience mutes with the sound effects
    this.musicIn = ctx.createGain();
    this.musicIn.gain.value = 0;
    const musicVerb = ctx.createGain();
    musicVerb.gain.value = 0.5;
    this.musicVol = ctx.createGain();
    this.musicVol.gain.value = this.vol.music / 0.8;
    this.musicIn.connect(this.musicVol);
    this.musicVol.connect(master);
    this.musicVol.connect(musicVerb);
    musicVerb.connect(conv);

    this.noise = this.makeNoise(2, false);
    this.pinkNoise = this.makeNoise(4, true);
  }

  /** player volume sliders (0..1). The defaults (0.9 / 0.8 / 0.8) give the original mix. */
  /** 青冥古林: the rain layer (hiss + drumming on leaves), 0 = dry .. 1 = downpour */
  private rainGain: GainNode | null = null;
  setRain(x: number) {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, x)) * 0.55, this.ctx.currentTime, 0.6);
  }

  setVolumes(sfx: number, music: number, amb: number) {
    this.vol = { sfx, music, amb };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxIn.gain.setTargetAtTime(sfx, t, 0.05);
    this.ambIn.gain.setTargetAtTime(0.5 * (amb / 0.8), t, 0.05);
    this.musicVol.gain.setTargetAtTime(music / 0.8, t, 0.05);
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
    this.rainGain = null;
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
    } else if (id === 'glacier') {
      // a howling blizzard: two wind voices with slow gusts, and now and then ice groaning
      loopNoise(this.pinkNoise, 'bandpass', 650, 1.4, 0.32, 0.06, 0.28);
      loopNoise(this.pinkNoise, 'bandpass', 1300, 2.2, 0.12, 0.13, 0.1);
      loopNoise(this.noise, 'highpass', 4000, 0.5, 0.03, 0.09, 0.02);
      this.ambTimer = window.setInterval(() => {
        if (Math.random() < 0.25) {
          const b = ambBus();
          this.thump(b, b.now, 60 + Math.random() * 30, 35, 0.9, 0.12, 0.4);
          this.metal(b, b.now + 0.1, 520 + Math.random() * 200, 0.025, 1.2, [1, 2.4, 3.9], 0.6);
        }
      }, 2200);
    } else if (id === 'rooftop') {
      // the Lantern Festival below: a city-wide murmur of crowds, distant fireworks, temple bells and drums
      loopNoise(this.pinkNoise, 'bandpass', 520, 0.9, 0.22, 0.05, 0.12);
      loopNoise(this.pinkNoise, 'bandpass', 1400, 1.6, 0.06, 0.17, 0.04);
      loopNoise(this.pinkNoise, 'lowpass', 160, 0.6, 0.18, 0.03, 0.08);
      this.ambTimer = window.setInterval(() => {
        const b = ambBus();
        if (Math.random() < 0.55) {
          // a far-off firework: soft thump, then a long crackle
          const t0 = b.now + Math.random() * 0.4;
          this.thump(b, t0, 90 + Math.random() * 40, 40, 0.5, 0.12, 0.35);
          for (let k = 0; k < 14; k++) this.burst(b, t0 + 0.25 + Math.random() * 0.9, 0.012, 'bandpass', 2500 + Math.random() * 3500, 0.03 + Math.random() * 0.03);
        }
        if (Math.random() < 0.18) this.metal(b, b.now, 392 * (Math.random() < 0.5 ? 1 : 1.5), 0.04, 3.5, [1, 2.76, 5.4], 0.8);
        if (Math.random() < 0.25) for (let k = 0; k < 4; k++) this.thump(b, b.now + k * 0.32, 110, 70, 0.35, 0.05, 0.15);
      }, 1600);
    } else if (id === 'forest') {
      // rain: broadband hiss plus a lower patter, faded in and out by setRain
      {
        const rg = ctx.createGain();
        rg.gain.value = 0;
        rg.connect(this.ambIn);
        this.rainGain = rg;
        for (const [buf, type, f, q, g] of [
          [this.noise, 'highpass', 2600, 0.5, 0.5],
          [this.pinkNoise, 'bandpass', 900, 0.8, 0.9],
        ] as [AudioBuffer, BiquadFilterType, number, number, number][]) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const fl = ctx.createBiquadFilter();
          fl.type = type;
          fl.frequency.value = f;
          fl.Q.value = q;
          const gn = ctx.createGain();
          gn.gain.value = g;
          src.connect(fl).connect(gn).connect(rg);
          src.start(0, Math.random() * 2);
          nodes.push(src);
        }
      }
      // a babbling stream, leaves stirring, birds calling from the canopy, now and then a woodpecker
      loopNoise(this.noise, 'bandpass', 1900, 0.9, 0.05, 0.9, 0.03);
      loopNoise(this.pinkNoise, 'bandpass', 700, 1.1, 0.08, 1.7, 0.05);
      loopNoise(this.pinkNoise, 'highpass', 3200, 0.5, 0.03, 0.08, 0.025);
      const chirp = (t0: number, f0: number, f1: number, dur: number, vol: number) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(this.verbIn);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      };
      this.ambTimer = window.setInterval(() => {
        const b = ambBus();
        if (Math.random() < 0.55) {
          // a songbird: a short run of quick rising and falling notes
          const base = 2600 + Math.random() * 1600;
          const n = 3 + Math.floor(Math.random() * 5);
          for (let k = 0; k < n; k++) {
            const t0 = b.now + Math.random() * 0.2 + k * (0.07 + Math.random() * 0.05);
            const up = Math.random() < 0.5;
            chirp(t0, base * (up ? 0.85 : 1.15), base * (up ? 1.2 : 0.8), 0.05 + Math.random() * 0.05, 0.012 + Math.random() * 0.01);
          }
        }
        if (Math.random() < 0.18) {
          // cuckoo-like two-note call far off
          chirp(b.now + 0.1, 820, 780, 0.22, 0.01);
          chirp(b.now + 0.45, 660, 620, 0.3, 0.01);
        }
        if (Math.random() < 0.08) for (let k = 0; k < 9; k++) this.burst(b, b.now + k * 0.055, 0.012, 'bandpass', 1800, 0.05);
      }, 1500);
    } else if (id === 'summit') {
      // thin high wind above the clouds, a crane calling, distant chimes
      loopNoise(this.pinkNoise, 'bandpass', 900, 1.8, 0.14, 0.05, 0.1);
      loopNoise(this.noise, 'highpass', 5000, 0.5, 0.02, 0.07, 0.015);
      this.ambTimer = window.setInterval(() => {
        const b = ambBus();
        if (Math.random() < 0.3) {
          // crane: two quick rising calls
          for (let k = 0; k < 2; k++) {
            const t0 = b.now + k * 0.28;
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.setValueAtTime(900, t0);
            o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.12);
            o.frequency.exponentialRampToValueAtTime(1100, t0 + 0.22);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.02, t0 + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
            o.connect(g).connect(this.verbIn);
            o.start(t0);
            o.stop(t0 + 0.26);
          }
        }
        if (Math.random() < 0.3) this.metal(b, b.now, 1568 * [1, 1.122, 1.335, 1.498][Math.floor(Math.random() * 4)], 0.035, 3, [1, 2.0, 3.01], 0.8);
      }, 2600);
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
  // Generative score.
  // An arranger that cycles through sections (引子 intro, 起 calm, 承 build, 转 battle, 合 finale, 散 breakdown),
  // each eight bars long, with a chord progression, a composed-on-the-fly melody and several
  // traditional voices: 古筝 guzheng, 笛子 dizi, 琵琶 pipa tremolo, 二胡 erhu, low bass, 大鼓 taiko,
  // 小鼓, 木鱼 woodblock, 钹 cymbal swells and a gong at the climax. Each map has its own mode and tempo,
  // and the arrangement leans toward the battle sections when a fight gets close.
  // ------------------------------------------------------------------
  private theme: MusicTheme = THEMES.temple;
  private pendingTheme: MusicTheme | null = null;
  private intensity = 0.3;
  private intensityTarget = 0.3;
  private secIdx = 0;
  private sec: SectionName = 'intro';
  private prog: number[] = [];
  private bar: { lead: NoteEv[]; zheng: number[] } = { lead: [], zheng: [] };
  private leadDeg = 7;
  private droneOsc: OscillatorNode[] = [];

  setMusicTheme(id: AmbienceId) {
    const t = THEMES[id === 'none' ? 'temple' : id] ?? THEMES.temple;
    if (t === this.theme) return;
    if (this.musicOn) this.pendingTheme = t;
    else this.theme = t;
  }
  setMusicIntensity(x: number) {
    this.intensityTarget = Math.max(0, Math.min(1, x));
  }

  private pluckBuffer(freq: number, bright = 0.5) {
    const key = freq.toFixed(1) + '|' + bright;
    const hit = this.pluckCache.get(key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.4);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Karplus-Strong plucked string; `bright` shapes the excitation (pipa is brighter than zheng)
    const N = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const w = Math.random() * 2 - 1;
      prev = prev * (1 - bright) + w * bright;
      ring[i] = prev;
    }
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

  /** Scale degree (any integer, wraps across octaves) to Hz in the current theme */
  private hz(deg: number, octave = 0) {
    const sc = this.theme.scale;
    const o = Math.floor(deg / sc.length);
    const semis = sc[((deg % sc.length) + sc.length) % sc.length] + 12 * (o + octave);
    return this.theme.root * Math.pow(2, semis / 12);
  }

  private pluck(at: number, freq: number, gain: number, bright = 0.5, decay = 2.3, pan = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq, bright);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400 + bright * 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(lp).connect(g).connect(p).connect(this.musicIn);
    src.start(at);
    src.stop(at + decay + 0.05);
  }

  /** 笛子: breathy bamboo flute with delayed vibrato and a scoop into the note */
  private dizi(at: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o.frequency.setValueAtTime(freq * 0.94, at);
    o.frequency.exponentialRampToValueAtTime(freq, at + 0.07);
    o2.frequency.setValueAtTime(freq * 2 * 0.94, at);
    o2.frequency.exponentialRampToValueAtTime(freq * 2, at + 0.07);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vd = ctx.createGain();
    vd.gain.setValueAtTime(0, at);
    vd.gain.linearRampToValueAtTime(freq * 0.012, at + Math.min(0.4, dur * 0.6));
    vib.connect(vd);
    vd.connect(o.frequency);
    vd.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.06);
    g.gain.setTargetAtTime(gain * 0.7, at + 0.1, 0.3);
    g.gain.setTargetAtTime(0.0001, at + dur - 0.05, 0.06);
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(g);
    o2.connect(g2).connect(g);
    // breath
    const br = ctx.createBufferSource();
    br.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = freq * 2;
    bf.Q.value = 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(gain * 0.5, at);
    bg.gain.exponentialRampToValueAtTime(gain * 0.06, at + 0.12);
    bg.gain.setTargetAtTime(0.0001, at + dur - 0.05, 0.06);
    br.connect(bf).connect(bg).connect(g);
    const p = ctx.createStereoPanner();
    p.pan.value = 0.15;
    g.connect(p).connect(this.musicIn);
    const end = at + dur + 0.4;
    [o, o2, vib].forEach((n) => {
      n.start(at);
      n.stop(end);
    });
    br.start(at, Math.random());
    br.stop(end);
  }

  /** 二胡: bowed, nasal, with a slide from the previous pitch */
  private erhu(at: number, freq: number, dur: number, gain: number, from?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(from ?? freq, at);
    o.frequency.exponentialRampToValueAtTime(freq, at + (from ? 0.12 : 0.01));
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vd = ctx.createGain();
    vd.gain.setValueAtTime(0, at);
    vd.gain.linearRampToValueAtTime(freq * 0.018, at + Math.min(0.5, dur * 0.7));
    vib.connect(vd).connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.12);
    g.gain.setTargetAtTime(0.0001, at + dur - 0.06, 0.08);
    const p = ctx.createStereoPanner();
    p.pan.value = -0.2;
    o.connect(bp).connect(lp).connect(g).connect(p).connect(this.musicIn);
    o.start(at);
    vib.start(at);
    o.stop(at + dur + 0.5);
    vib.stop(at + dur + 0.5);
  }

  /** 钹: a cymbal swelling up into the next section */
  private cymbalSwell(at: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.05);
    src.connect(hp).connect(g).connect(this.musicIn);
    src.start(at, Math.random());
    src.stop(at + dur + 0.1);
  }

  private mbus(at: number): Bus {
    return { ctx: this.ctx!, out: this.musicIn, verb: this.verbIn, now: at };
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const ctx = this.ctx;
    this.musicIn.gain.cancelScheduledValues(ctx.currentTime);
    this.musicIn.gain.setTargetAtTime(0.24, ctx.currentTime, 0.8);
    // drone: tonic + fifth, gently breathing; retuned when the map's theme changes
    const nodes: AudioScheduledSourceNode[] = [];
    this.droneOsc = [0, 7].map((semi, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'sine';
      o.frequency.value = (this.theme.root / 2) * Math.pow(2, semi / 12);
      const g = ctx.createGain();
      g.gain.value = i ? 0.04 : 0.08;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08 + i * 0.05;
      const d = ctx.createGain();
      d.gain.value = 0.025;
      lfo.connect(d).connect(g.gain);
      o.connect(g).connect(this.musicIn);
      o.start();
      lfo.start();
      nodes.push(o, lfo);
      return o;
    });
    this.drone = { stop: () => nodes.forEach((o) => o.stop()) };
    this.musicNext = ctx.currentTime + 0.15;
    this.musicStep = 0;
    this.secIdx = -1;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx) return;
      this.intensity += (this.intensityTarget - this.intensity) * 0.05;
      while (this.musicNext < this.ctx.currentTime + 0.3) {
        const step = 60 / this.theme.bpm / 2;
        this.scheduleStep(this.musicNext, step);
        this.musicNext += step;
        this.musicStep++;
      }
    }, 50);
  }

  private nextSection() {
    if (this.pendingTheme) {
      this.theme = this.pendingTheme;
      this.pendingTheme = null;
      const t = this.ctx!.currentTime;
      this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime((this.theme.root / 2) * Math.pow(2, (i ? 7 : 0) / 12), t, 0.5));
    }
    this.secIdx++;
    const order: SectionName[] = ['intro', 'qi', 'cheng', 'zhuan', 'qi', 'zhuan', 'he', 'san'];
    let s = order[this.secIdx % order.length];
    // a tense fight skips the quiet parts
    if (this.intensity > 0.65 && (s === 'qi' || s === 'san' || s === 'intro')) s = Math.random() < 0.5 ? 'zhuan' : 'he';
    if (this.intensity < 0.2 && s === 'he') s = 'cheng';
    this.sec = s;
    this.prog = PROGS[Math.floor(Math.random() * PROGS.length)];
  }

  /** Compose one bar: a lead rhythm walking near the chord tones, and a zheng arpeggio */
  private composeBar(chord: number) {
    const rh = RHYTHMS[Math.floor(Math.random() * RHYTHMS.length)];
    const lead: NoteEv[] = [];
    let t = 0;
    for (const len of rh) {
      if (len < 0) {
        t += -len;
        continue;
      }
      // strong beats land on chord tones (root, third, fifth of the pentatonic chord)
      const strong = t % 4 === 0;
      if (strong) {
        const targets = [chord, chord + 2, chord + 3, chord + 5].map((x) => x + 5);
        targets.sort((a, b) => Math.abs(a - this.leadDeg) - Math.abs(b - this.leadDeg));
        this.leadDeg = targets[Math.random() < 0.7 ? 0 : 1];
      } else this.leadDeg += Math.random() < 0.5 ? 1 : -1;
      this.leadDeg = Math.max(3, Math.min(13, this.leadDeg));
      lead.push({ at: t, len, deg: this.leadDeg });
      t += len;
    }
    const pat = ARPS[Math.floor(Math.random() * ARPS.length)];
    this.bar = { lead, zheng: pat.map((x) => (x < -50 ? -99 : chord + x)) };
  }

  private scheduleStep(at: number, step: number) {
    const s = this.musicStep;
    if (s % 64 === 0) this.nextSection();
    const barIdx = Math.floor(s / 8) % 8;
    const pos = s % 8;
    const chord = this.prog[barIdx] ?? 0;
    if (pos === 0) this.composeBar(chord);
    const sec = this.sec;
    const b = this.mbus(at);
    const busy = sec === 'zhuan' || sec === 'he';
    const lastBar = barIdx === 7;

    // section entrances
    if (s % 64 === 0) {
      if (busy) this.gongStrike(at, sec === 'he' ? 0.32 : 0.22);
      // guzheng glissando sweeping up into the section
      for (let k = 0; k < 7; k++) this.pluck(at + k * 0.035, this.hz(chord + k, 0), 0.12 + k * 0.01, 0.45, 1.6, -0.3);
    }
    if (lastBar && pos === 4 && this.secIdx >= 0) this.cymbalSwell(at, step * 4, busy ? 0.08 : 0.04);

    // drone / bass: a low plucked root on the chord change
    if (pos === 0) this.pluck(at, this.hz(chord, -2), sec === 'intro' ? 0.18 : 0.3, 0.25, 2.2);
    if (busy && (pos === 3 || pos === 6)) this.pluck(at, this.hz(chord, -2), 0.2, 0.25, 0.8);
    if (busy && pos === 4) this.pluck(at, this.hz(chord + 3, -2), 0.22, 0.25, 1.0);

    // 古筝 arpeggios (everywhere but the battle sections, where the pipa takes over)
    const z = this.bar.zheng[pos];
    if (sec !== 'zhuan' && z !== undefined && z > -50) {
      const g = sec === 'intro' ? 0.2 : 0.26;
      this.pluck(at, this.hz(z, -1), g, 0.45, 2.3, -0.25);
      if (sec === 'san' && Math.random() < 0.3) this.pluck(at + step * 0.5, this.hz(z + 1, -1), g * 0.6, 0.45, 2.0, -0.25);
    }

    // lead voice: dizi in 承/合/散, erhu answers in 转; pipa tremolo doubles in battle
    for (const n of this.bar.lead) {
      if (n.at !== pos) continue;
      const f = this.hz(n.deg, 0);
      const dur = n.len * step;
      if (sec === 'cheng' || sec === 'he' || sec === 'san') this.dizi(at, f, dur * 0.95, sec === 'san' ? 0.07 : 0.06);
      if (sec === 'zhuan' || sec === 'he') {
        if (sec === 'zhuan') this.erhu(at, f / 2, dur * 0.95, 0.05, n.len >= 3 && Math.random() < 0.5 ? this.hz(n.deg - 1, -1) : undefined);
        // 琵琶 tremolo: rapid repeated plucks on long notes
        const reps = Math.max(2, Math.round(n.len * 4));
        for (let r = 0; r < reps; r++) this.pluck(at + (r * dur) / reps, f, 0.11 * (1 - r / (reps * 1.6)), 0.75, 0.35, 0.3);
      }
      if (sec === 'qi' && barIdx % 2 === 1) this.pluck(at, f, 0.16, 0.6, 1.6, 0.25); // sparse melody on zheng
    }

    // percussion
    const intense = this.intensity > 0.6;
    if (sec === 'intro') {
      if (pos === 0 && barIdx % 2 === 0) this.taiko(b, at, 0.4);
    } else if (sec === 'qi' || sec === 'san') {
      if (pos === 0) this.taiko(b, at, 0.4);
      if (sec === 'qi' && pos === 6 && barIdx % 4 === 3) this.taiko(b, at, 0.25);
    } else if (sec === 'cheng') {
      if (pos === 0) this.taiko(b, at, 0.45);
      if (pos === 3 || pos === 5) this.woodblock(at, pos === 3 ? 0.12 : 0.08);
      if (pos === 6) this.smallDrum(at, 0.18);
    } else {
      // battle groove: 咚 . . 咚 . 咚 . . with small drum fills, harder when intense
      const groove = [1, 0, 0, 0.7, 0, 0.8, 0, 0];
      if (groove[pos]) this.taiko(b, at, 0.45 * groove[pos] + (intense ? 0.12 : 0));
      if (pos === 2 || pos === 6) this.smallDrum(at, 0.16);
      if (pos % 2 === 1) this.woodblock(at, 0.05);
      if (lastBar && pos >= 4) this.smallDrum(at + step * 0.5, 0.14);
      if (intense && pos === 4) this.taiko(b, at, 0.3);
    }
  }

  private gongStrike(at: number, gain: number) {
    this.metal(this.mbus(at), at, this.theme.root / 1.5, gain, 4.5, [1, 1.47, 2.06, 2.83, 3.6, 4.4], 0.8);
  }
  private smallDrum(at: number, gain: number) {
    const b = this.mbus(at);
    this.thump(b, at, 240, 140, 0.18, gain, 0.2);
    this.burst(b, at, 0.05, 'bandpass', 1600, gain * 0.4);
  }
  private woodblock(at: number, gain: number) {
    this.thump(this.mbus(at), at, 1250, 1050, 0.05, gain, 0.1);
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

// ----------------------------------------------------------------------
// score data
// ----------------------------------------------------------------------
type SectionName = 'intro' | 'qi' | 'cheng' | 'zhuan' | 'he' | 'san';
interface NoteEv {
  at: number; // step within the bar (eighths)
  len: number; // eighths
  deg: number;
}
interface MusicTheme {
  root: number; // Hz of scale degree 0 (melody octave)
  bpm: number;
  scale: number[];
}
const THEMES: Record<'temple' | 'lavacliff' | 'sea' | 'glacier' | 'rooftop' | 'summit' | 'forest', MusicTheme> = {
  // 商调 on F: green, lilting, a little mysterious
  forest: { root: 349.23, bpm: 88, scale: [0, 2, 5, 7, 10] },
  // 宫调 on G: bright and festive, a Tang court at the Lantern Festival
  rooftop: { root: 392, bpm: 100, scale: [0, 2, 4, 7, 9] },
  // 徵调 on C: wide and solemn, the gate of heaven
  summit: { root: 261.63, bpm: 78, scale: [0, 2, 5, 7, 9] },
  // 羽调 on D: open, majestic
  temple: { root: 293.66, bpm: 84, scale: [0, 3, 5, 7, 10] },
  // E with a flattened second: dark and driving
  lavacliff: { root: 329.63, bpm: 104, scale: [0, 1, 5, 7, 8] },
  // A minor pentatonic, restless
  sea: { root: 220, bpm: 96, scale: [0, 3, 5, 7, 10] },
  // B, sparse and cold
  glacier: { root: 246.94, bpm: 72, scale: [0, 2, 5, 7, 10] },
};
// chord roots per bar, as scale degrees
const PROGS = [
  [0, 0, 3, 2, 0, 0, 4, 3],
  [0, 2, 3, 0, 4, 3, 2, 0],
  [0, 4, 3, 4, 0, 2, 3, 4],
  [3, 2, 0, 0, 3, 4, 2, 0],
];
// lead rhythms in eighths (negative = rest)
const RHYTHMS = [
  [4, 2, 2],
  [2, 2, 4],
  [3, 1, 4],
  [6, 2],
  [8],
  [2, 1, 1, 4],
  [-2, 2, 4],
  [4, -2, 2],
  [1, 1, 2, 4],
];
// guzheng arpeggio shapes relative to the chord root (-99 = rest)
const ARPS = [
  [0, 2, 3, 5, 3, 2, 0, -99],
  [0, 3, 5, 7, 5, 3, -99, 2],
  [0, -99, 3, 2, 5, -99, 3, 2],
  [0, 5, 3, 5, 2, 5, 3, -99],
];

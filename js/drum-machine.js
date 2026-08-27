/**
 * DrumMachine — TR-808-style drum synthesis + step sequencer.
 *
 * No DOM here; the UI lives in drum-panel.js.
 *
 * Pattern model:
 *   hits = [{ t: <float ticks>, inst: <instrument index> }]
 *   t is in ticks from the start of the pattern (0 <= t < totalTicks).
 *   TICKS_PER_BAR = 96, so every snap division (2,4,8,12,16,32 per bar)
 *   lands on an integer tick, and "off" allows free (fractional) positions.
 *
 * Snap: divisions per bar (2, 4, 8, 12, 16, 32) or 0 = off (free position).
 */

const DRUM_INSTRUMENTS = [
  { id: "bd", name: "Bass Drum", short: "BD" },
  { id: "sd", name: "Snare Drum", short: "SD" },
  { id: "lt", name: "Low Tom", short: "LT" },
  { id: "mt", name: "Mid Tom", short: "MT" },
  { id: "ht", name: "Hi Tom", short: "HT" },
  { id: "hc", name: "Hand Clap", short: "HC" },
  { id: "cb", name: "Cowbell", short: "CB" },
  { id: "cy", name: "Cymbal", short: "CY" },
  { id: "oh", name: "Open Hihat", short: "OH" },
  { id: "ch", name: "Closed Hihat", short: "CH" },
];

const TICKS_PER_BAR = 96; // 24 ticks per beat, 6 ticks per 16th
const SNAP_DIVISIONS = [2, 4, 8, 12, 16, 32, 0]; // index 6 = off

class DrumMachine {
  constructor(engine) {
    this.engine = engine; // AudioEngine — used for the shared AudioContext
    this.params = {
      tempo: 120, // BPM
      snap: 16, // divisions per bar; 0 = off
      bars: 1,
      master: 0.8,
    };
    this.levels = {};
    DRUM_INSTRUMENTS.forEach((d) => (this.levels[d.id] = 0.8));
    this.tones = { bd: 120, sd: 3500, cy: 6000 };
    this.tunings = { lt: 1, mt: 1, ht: 1 };
    this.decays = { bd: 0.5, cy: 1.5, oh: 0.5 };

    this.hits = []; // { t, inst }
    this.playing = false;
    this._sched = null;
    this._drumMaster = null;
    this._noiseBuf = null;
  }

  /* ---------------- params ---------------- */

  setTempo(v) {
    this.params.tempo = v;
  }
  setSnap(divisions) {
    this.params.snap = divisions;
  }
  setBars(n) {
    this.params.bars = Math.min(8, Math.max(1, Math.round(n)));
  }
  setMaster(v) {
    this.params.master = v;
    if (this._drumMaster && this.engine.ctx) {
      this._drumMaster.gain.setTargetAtTime(
        v,
        this.engine.ctx.currentTime,
        0.01
      );
    }
  }
  setLevel(id, v) {
    this.levels[id] = v;
  }
  setTone(id, v) {
    this.tones[id] = v;
  }
  setTuning(id, v) {
    this.tunings[id] = v;
  }
  setDecay(id, v) {
    this.decays[id] = v;
  }

  get totalTicks() {
    return this.params.bars * TICKS_PER_BAR;
  }

  /* ---------------- pattern ---------------- */

  /** Quantize a tick position to the current snap setting (wraps into range). */
  snapTo(t) {
    const total = this.totalTicks;
    let x = ((t % total) + total) % total;
    const div = this.params.snap;
    if (div > 0) {
      const size = TICKS_PER_BAR / div; // integer for every snap value
      x = Math.round(x / size) * size;
      if (x >= total) x -= total;
    }
    return x;
  }

  addHit(t, inst) {
    const q = this.snapTo(t);
    const hit = { t: q, inst };
    this.hits.push(hit);
    this.hits.sort((a, b) => a.t - b.t);
    return this.hits.indexOf(hit);
  }

  moveHit(i, t) {
    if (i < 0 || i >= this.hits.length) return;
    this.hits[i].t = this.snapTo(t);
    this.hits.sort((a, b) => a.t - b.t);
  }

  removeHit(i) {
    this.hits.splice(i, 1);
  }

  clear() {
    this.hits = [];
  }

  /** Index of the hit in `lane` within `radius` ticks of `t`, or -1. */
  hitAt(lane, t, radius) {
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      if (h.inst === lane && Math.abs(h.t - t) <= radius) return i;
    }
    return -1;
  }

  /* ---------------- sequencer ---------------- */

  /** Duration of one tick (1/96 of a bar) in seconds. */
  _stepDur() {
    return 60 / this.params.tempo / 24;
  }

  start() {
    if (this.playing) return;
    this.engine.ensure();
    const ctx = this.engine.ctx;
    this.playing = true;
    const LOOKAHEAD = 0.12; // seconds scheduled ahead
    const INTERVAL = 25; // ms between scheduler passes
    const sched = {
      nextTime: ctx.currentTime + 0.05,
      step: 0, // absolute tick index (unbounded)
      timer: null,
    };
    const schedule = () => {
      const total = this.totalTicks;
      while (sched.nextTime < ctx.currentTime + LOOKAHEAD) {
        const tick = sched.step % total;
        // Fire every hit whose tick falls in [tick, tick+1), at its exact time.
        for (const h of this.hits) {
          if (h.t >= tick && h.t < tick + 1) {
            this.trigger(
              h.inst,
              sched.nextTime + (h.t - tick) * this._stepDur()
            );
          }
        }
        sched.nextTime += this._stepDur();
        sched.step++;
      }
    };
    schedule();
    sched.timer = setInterval(schedule, INTERVAL);
    this._sched = sched;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this._sched) clearInterval(this._sched.timer);
    this._sched = null;
  }

  /** Current playhead in pattern ticks (float), or null when stopped. */
  getPlayhead() {
    if (!this.playing || !this._sched) return null;
    const ctx = this.engine.ctx;
    const cur = this._sched.nextTime - this._stepDur();
    const frac = (ctx.currentTime - cur) / this._stepDur();
    const abs = this._sched.step - 1 + frac;
    const total = this.totalTicks;
    return ((abs % total) + total) % total;
  }

  /* ---------------- synthesis ---------------- */

  _ensureDrumMaster() {
    const ctx = this.engine.ctx;
    if (!this._drumMaster) {
      this._drumMaster = ctx.createGain();
      this._drumMaster.gain.value = this.params.master;
      this._drumMaster.connect(ctx.destination);
    }
  }

  _getNoiseBuf() {
    const ctx = this.engine.ctx;
    if (!this._noiseBuf) {
      const len = ctx.sampleRate; // 1 second of white noise
      this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this._noiseBuf;
  }

  _noise(when, dur) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuf();
    src.start(when);
    src.stop(when + dur + 0.05);
    return src;
  }

  /** Trigger instrument `inst` (0..9) at audio time `when`. */
  trigger(inst, when) {
    this.engine.ensure();
    const ctx = this.engine.ctx;
    this._ensureDrumMaster();
    when = Math.max(when, ctx.currentTime);

    const out = ctx.createGain();
    out.gain.value = this.levels[DRUM_INSTRUMENTS[inst].id];
    out.connect(this._drumMaster);

    const id = DRUM_INSTRUMENTS[inst].id;
    if (id === "bd") this._bassDrum(out, when);
    else if (id === "sd") this._snare(out, when);
    else if (id === "lt" || id === "mt" || id === "ht")
      this._tom(out, when, id);
    else if (id === "hc") this._clap(out, when);
    else if (id === "cb") this._cowbell(out, when);
    else if (id === "cy") this._cymbal(out, when);
    else if (id === "oh") this._hihat(out, when, this.decays.oh);
    else if (id === "ch") this._hihat(out, when, 0.05);
  }

  _bassDrum(out, when) {
    const ctx = this.engine.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(this.tones.bd, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + this.decays.bd);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + this.decays.bd + 0.05);
  }

  _snare(out, when) {
    const ctx = this.engine.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = this.tones.sd;
    bp.Q.value = 1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.8, when);
    ng.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    this._noise(when, 0.2).connect(bp);
    bp.connect(ng);
    ng.connect(out);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 180;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, when);
    og.gain.exponentialRampToValueAtTime(0.001, when + 0.08);
    o.connect(og);
    og.connect(out);
    o.start(when);
    o.stop(when + 0.1);
  }

  _tom(out, when, id) {
    const ctx = this.engine.ctx;
    const base = { lt: 90, mt: 130, ht: 190 }[id];
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = base * this.tunings[id];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + 0.4);
  }

  _clap(out, when) {
    const ctx = this.engine.ctx;
    for (let i = 0; i < 3; i++) {
      const t = when + i * 0.01;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1200;
      bp.Q.value = 1.5;
      const g = ctx.createGain();
      const dur = i === 2 ? 0.2 : 0.05;
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      this._noise(t, dur).connect(bp);
      bp.connect(g);
      g.connect(out);
    }
  }

  _cowbell(out, when) {
    const ctx = this.engine.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    lp.connect(out);
    for (const f of [540, 810]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
      o.connect(g);
      g.connect(lp);
      o.start(when);
      o.stop(when + 0.35);
    }
  }

  _cymbal(out, when) {
    const ctx = this.engine.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + this.decays.cy);
    this._noise(when, this.decays.cy).connect(hp);
    hp.connect(g);
    g.connect(out);
  }

  _hihat(out, when, decay) {
    const ctx = this.engine.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 9000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + decay);
    this._noise(when, decay).connect(hp);
    hp.connect(g);
    g.connect(out);
  }

  /** Play an instrument immediately (for UI preview). */
  preview(inst) {
    this.engine.ensure();
    this.trigger(inst, this.engine.ctx.currentTime);
  }
}

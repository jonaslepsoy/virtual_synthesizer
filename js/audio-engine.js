/**
 * AudioEngine — Web Audio API synth.
 *
 * Signal chain per voice:
 *   osc -> highpass -> lowpass -> bandpass -> gain(ADSR) -> master
 *   lfo(vibrato) -> lfoGain -> osc.detune
 */

const WAVEFORMS = ["sine", "square", "sawtooth", "triangle", "supersaw"];

// Classic JP-8000-style supersaw: 5 detuned sawtooth voices.
const SUPERSAW_VOICES = 5;
const SUPERSAW_SPREAD = 15; // cents, outermost voice offset from center

function isSupersaw(name) {
  return name === "supersaw";
}

/** Symmetric detune offsets (cents) for a supersaw stack. */
function supersawDetunes() {
  const n = SUPERSAW_VOICES;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
    out.push(t * 2 * SUPERSAW_SPREAD);
  }
  return out;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;

    this.params = {
      waveform: 0, // index into WAVEFORMS
      attack: 0.01,
      decay: 0.2,
      sustain: 0.7,
      release: 0.4,
      arpMode: 0, // 0 = off, 1 = major, 2 = minor
      arpRate: 30, // notes per second
      vibRate: 5.5, // Hz
      vibDepth: 0, // cents
      hpCutoff: 20,
      hpRes: 0.5,
      lpCutoff: 18000,
      lpRes: 0.5,
      bpCutoff: 12000,
      bpRes: 0.5,
      volume: 0.8,
    };

    this.voices = new Map(); // midi -> voice (held notes)
    this.arpTimers = new Map(); // midi -> timeout id (arpeggiating notes)
  }

  /** Lazily create/resume the AudioContext (must follow a user gesture). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.params.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  /** Set the master output volume (0..1). */
  setVolume(v) {
    this.params.volume = v;
    if (this.master) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }
  }

  /* ---------------- note handling ---------------- */

  noteOn(midi) {
    this.ensure();
    if (this.voices.has(midi) || this.arpTimers.has(midi)) return;
    if (this.params.arpMode > 0) {
      this._startArp(midi);
    } else {
      this.voices.set(midi, this._startVoice(midi, { pluck: false }));
    }
  }

  noteOff(midi) {
    if (!this.ctx) return;
    if (this.arpTimers.has(midi)) {
      this._stopArp(midi);
      return;
    }
    const v = this.voices.get(midi);
    if (!v) return;
    this.voices.delete(midi);

    const now = this.ctx.currentTime;
    const r = Math.max(0.01, this.params.release);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + r);
    for (const o of v.oscs) o.stop(now + r + 0.05);
    v.lfo.stop(now + r + 0.05);
  }

  /** Release everything (e.g. on window blur). */
  allOff() {
    for (const midi of [...this.voices.keys()]) this.noteOff(midi);
    for (const midi of [...this.arpTimers.keys()]) this.noteOff(midi);
  }

  /* ---------------- voice ---------------- */

  _startVoice(midi, { pluck, at, pluckLen }) {
    const ctx = this.ctx;
    const p = this.params;
    const now = at ?? ctx.currentTime;

    const waveName = WAVEFORMS[p.waveform];
    const freq = midiToFreq(midi);

    // Supersaw: a stack of detuned sawtooth oscillators (JP-8000 style).
    const oscs = isSupersaw(waveName)
      ? supersawDetunes().map((cents) => {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = freq;
          o.detune.value = cents;
          return o;
        })
      : [ctx.createOscillator()];
    if (!isSupersaw(waveName)) {
      oscs[0].type = waveName;
      oscs[0].frequency.value = freq;
    }

    // Vibrato: LFO -> gain(cents) -> detune (all voices)
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = p.vibRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = p.vibDepth;
    lfo.connect(lfoGain);
    for (const o of oscs) lfoGain.connect(o.detune);

    // Filters in series
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = p.hpCutoff;
    hp.Q.value = p.hpRes;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.lpCutoff;
    lp.Q.value = p.lpRes;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = p.bpCutoff;
    bp.Q.value = p.bpRes;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    for (const o of oscs) o.connect(hp);
    hp.connect(lp);
    lp.connect(bp);
    bp.connect(gain);
    gain.connect(this.master);

    const a = Math.max(0.001, p.attack);
    const d = Math.max(0.001, p.decay);

    if (pluck) {
      // Arpeggio pluck: snappy attack -> decay to zero, then stop.
      // Length is clamped so fast chiptune arps don't smear into each other.
      const pa = Math.min(a, 0.005);
      const pd = pluckLen ?? Math.min(d, 0.08);
      const total = pa + pd + 0.02;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + pa);
      gain.gain.linearRampToValueAtTime(0, now + pa + pd);
      for (const o of oscs) o.start(now);
      lfo.start(now);
      for (const o of oscs) o.stop(now + total);
      lfo.stop(now + total);
    } else {
      // Sustained note: attack -> decay -> sustain (release on noteOff).
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + a);
      gain.gain.linearRampToValueAtTime(p.sustain, now + a + d);
      for (const o of oscs) o.start(now);
      lfo.start(now);
    }

    return { oscs, lfo, gain, hp, lp, bp };
  }

  /* ---------------- arpeggiator ----------------
   * Lookahead scheduler: a 25 ms interval schedules plucks up to
   * 120 ms ahead on the audio clock, so timing stays sample-accurate
   * even at very high rates where setTimeout jitter would smear.
   */

  _startArp(midi) {
    const LOOKAHEAD = 0.12; // seconds scheduled ahead
    const INTERVAL = 25; // ms between scheduler passes

    const state = {
      nextTime: this.ctx.currentTime + 0.01,
      step: 0,
      timer: null,
    };

    const schedule = () => {
      const p = this.params;
      const third = p.arpMode === 1 ? 4 : 3; // major vs minor 3rd
      const chord = [midi, midi + third, midi + 7];
      const interval = 1 / Math.max(1, p.arpRate);

      while (state.nextTime < this.ctx.currentTime + LOOKAHEAD) {
        this._startVoice(chord[state.step % chord.length], {
          pluck: true,
          at: state.nextTime,
        });
        state.step++;
        state.nextTime += interval;
      }
    };

    schedule();
    state.timer = setInterval(schedule, INTERVAL);
    this.arpTimers.set(midi, state);
  }

  _stopArp(midi) {
    const state = this.arpTimers.get(midi);
    if (state) clearInterval(state.timer);
    this.arpTimers.delete(midi);
  }
}

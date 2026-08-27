/**
 * Piano — renders a multi-octave keyboard on a canvas and maps
 * mouse/touch and computer-keyboard input to note on/off events.
 */
class Piano {
  constructor(canvas, { onNoteOn, onNoteOff, baseOctave = 3 }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;

    // Octave of the C played by the "z" and "q" keys (C1..C7).
    this.baseOctave = baseOctave;

    this.whiteKeys = [];
    this.blackKeys = [];
    this.pressed = new Set(); // midi currently held
    this._pointerKey = null; // midi held by the pointer (for glissando)
    this._heldKeys = new Set(); // keyboard keys currently held

    this._rebuild();
    this._resize();

    this._bindPointer();
    this._bindKeyboard();

    window.addEventListener("resize", () => this._resize());
    window.addEventListener("blur", () => this._releaseAll());
  }

  /** MIDI number of the C in the given octave (C0 = 12). */
  _octaveC(oct) {
    return 12 * (oct + 1);
  }

  /** Rebuild the visible range and keyboard map for the current base octave. */
  _rebuild() {
    const base = this._octaveC(this.baseOctave);
    // Three octaves starting at the base C.
    this.startMidi = base;
    this.endMidi = base + 35;
    this._layout();
    this._buildKeyMap();
  }

  /** Change which octave the "z"/"q" keys start on. Releases held notes. */
  setBaseOctave(oct) {
    const next = Math.min(7, Math.max(1, Math.round(oct)));
    if (next === this.baseOctave) return;
    this._releaseAll();
    this.baseOctave = next;
    this._rebuild();
    this._resize();
  }

  /* ---------------- layout ---------------- */

  _isBlack(midi) {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  }

  _layout() {
    this.whiteKeys = [];
    this.blackKeys = [];
    for (let m = this.startMidi; m <= this.endMidi; m++) {
      if (this._isBlack(m)) this.blackKeys.push(m);
      else this.whiteKeys.push(m);
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    this._draw();
  }

  _whiteWidth() {
    return this.w / this.whiteKeys.length;
  }

  _keyRect(midi) {
    const ww = this._whiteWidth();
    if (!this._isBlack(midi)) {
      const idx = this.whiteKeys.indexOf(midi);
      return { x: idx * ww, y: 0, w: ww, h: this.h, black: false };
    }
    // Black key: centered on the boundary before the next white key.
    const bw = ww * 0.62;
    const bh = this.h * 0.62;
    let nextWhite = null;
    for (const wm of this.whiteKeys) {
      if (wm > midi) {
        nextWhite = wm;
        break;
      }
    }
    const idx = nextWhite === null ? this.whiteKeys.length - 1 : this.whiteKeys.indexOf(nextWhite);
    const x = idx * ww - bw / 2;
    return { x, y: 0, w: bw, h: bh, black: true };
  }

  _keyAt(px, py) {
    // Black keys are drawn on top, so test them first.
    for (const m of this.blackKeys) {
      const r = this._keyRect(m);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return m;
    }
    for (const m of this.whiteKeys) {
      const r = this._keyRect(m);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return m;
    }
    return null;
  }

  /* ---------------- drawing ---------------- */

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    for (const m of this.whiteKeys) {
      const r = this._keyRect(m);
      const on = this.pressed.has(m);
      ctx.fillStyle = on ? "#2f6f68" : "#f4f5f7";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#0a0c0f";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }

    for (const m of this.blackKeys) {
      const r = this._keyRect(m);
      const on = this.pressed.has(m);
      ctx.fillStyle = on ? "#4fd1c5" : "#14171c";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }

  _setPressed(midi, on) {
    if (on) this.pressed.add(midi);
    else this.pressed.delete(midi);
    this._draw();
  }

  /* ---------------- pointer input ---------------- */

  _bindPointer() {
    const c = this.canvas;

    const pos = (e) => {
      const rect = c.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      const m = this._keyAt(x, y);
      if (m !== null) {
        this._pointerKey = m;
        this._setPressed(m, true);
        this.onNoteOn(m);
      }
    });

    c.addEventListener("pointermove", (e) => {
      if (this._pointerKey === null) return;
      const { x, y } = pos(e);
      const m = this._keyAt(x, y);
      if (m === this._pointerKey) return;
      // Glissando: release old, trigger new.
      this._setPressed(this._pointerKey, false);
      this.onNoteOff(this._pointerKey);
      this._pointerKey = m;
      if (m !== null) {
        this._setPressed(m, true);
        this.onNoteOn(m);
      }
    });

    const release = (e) => {
      if (this._pointerKey !== null) {
        this._setPressed(this._pointerKey, false);
        this.onNoteOff(this._pointerKey);
        this._pointerKey = null;
      }
      try {
        c.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
  }

  /* ---------------- keyboard input ---------------- */

  /**
   * Build the keyboard map for the current base octave.
   *
   * Lower octave (starts at base C):
   *   z=C  s=C#  x=D  d=D#  c=E  v=F  g=F#  b=G  h=G#  n=A  j=A#  m=B  ,=C(next)
   * Higher octave (starts at base C + 12):
   *   q=C  2=C#  w=D  3=D#  e=E  r=F  5=F#  t=G  6=G#  y=A  7=A#  u=B  i=C(next)
   */
  _buildKeyMap() {
    const base = this._octaveC(this.baseOctave);
    const map = {};

    // Lower octave — [key, semitone offset from base C]
    const lower = [
      ["z", 0], ["s", 1], ["x", 2], ["d", 3], ["c", 4], ["v", 5],
      ["g", 6], ["b", 7], ["h", 8], ["n", 9], ["j", 10], ["m", 11],
      [",", 12], ["l", 13], [".", 14], ["ø", 15], ["-", 16],
    ];
    for (const [k, off] of lower) map[k] = base + off;

    // Higher octave — [key, semitone offset from base C]
    const upper = [
      ["q", 12], ["2", 13], ["w", 14], ["3", 15], ["e", 16], ["r", 17],
      ["5", 18], ["t", 19], ["6", 20], ["y", 21], ["7", 22], ["u", 23],
      ["i", 24], ["9", 25], ["o", 26], ["0", 27], ["p", 28], ["å", 29],
    ];
    for (const [k, off] of upper) map[k] = base + off;

    this._keyMap = map;
  }

  _bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const m = this._keyMap[k];
      if (m === undefined) return;
      if (this._heldKeys.has(k)) return;
      this._heldKeys.add(k);
      this._setPressed(m, true);
      this.onNoteOn(m);
    });

    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      const m = this._keyMap[k];
      if (m === undefined) return;
      if (!this._heldKeys.has(k)) return;
      this._heldKeys.delete(k);
      this._setPressed(m, false);
      this.onNoteOff(m);
    });
  }

  _releaseAll() {
    for (const m of [...this.pressed]) {
      this._setPressed(m, false);
      this.onNoteOff(m);
    }
    this._pointerKey = null;
    this._heldKeys.clear();
  }
}

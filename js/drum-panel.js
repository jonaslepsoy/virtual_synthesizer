/**
 * DrumPanel — builds the TR-808-style drum machine section and wires its
 * controls to a DrumMachine. Owns the editable pattern-preview canvas.
 *
 * Layout (horizontal band):
 *   [Transport] [Instruments] [Master] [Pattern preview]
 *
 * Instruments group: one column per instrument — volume knob on top,
 * that instrument's sound knobs (tone/tune/decay) stacked below.
 */
class DrumPanel {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.machine = new DrumMachine(engine);
    this.selectedInst = 0;
    this.recording = false;
    this._lastBeat = -1;
    this._lightTimer = null;
    this._drag = null;

    this._build();
    this._bindSpace();
    this._bindPreview();

    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._loop = this._loop.bind(this);
    this._loop();
  }

  /* ---------------- DOM construction ---------------- */

  _group(title) {
    const el = document.createElement("div");
    el.className = "drum-group";
    const h = document.createElement("h2");
    h.textContent = title;
    el.appendChild(h);
    const row = document.createElement("div");
    row.className = "drum-row";
    el.appendChild(row);
    this.container.appendChild(el);
    return row;
  }

  _build() {
    const m = this.machine;
    const knob = (row, opts) => {
      const k = new Knob(opts);
      row.appendChild(k.wrap);
      return k;
    };
    const slider = (row, opts) => {
      const s = new Slider(opts);
      row.appendChild(s.wrap);
      return s;
    };

    /* ---- Transport ---- */
    const transport = this._group("Transport");
    const tempoKnob = knob(transport, {
      label: "Tempo",
      value: m.params.tempo,
      min: 40,
      max: 240,
      step: 1,
      defaultValue: 120,
      size: 84,
      format: (v) => Math.round(v) + " BPM",
      onChange: (v) => m.setTempo(v),
    });
    tempoKnob.wrap.style.width = "96px";

    const btnCol = document.createElement("div");
    btnCol.className = "drum-btn-col";
    transport.appendChild(btnCol);

    this.btnPlay = this._button("Start");
    this.btnPlay.addEventListener("click", () => {
      this._togglePlay();
      this.btnPlay.blur();
    });
    btnCol.appendChild(this.btnPlay);

    this.btnRecord = this._button("Rec", "record");
    this.btnRecord.addEventListener("click", () => {
      this.recording = !this.recording;
      this.btnRecord.classList.toggle("active", this.recording);
      if (this.recording && !m.playing) this._togglePlay();
      this.btnRecord.blur();
    });
    btnCol.appendChild(this.btnRecord);

    this.btnClear = this._button("Clear");
    this.btnClear.addEventListener("click", () => {
      m.clear();
      this.btnClear.blur();
    });
    btnCol.appendChild(this.btnClear);

    slider(transport, {
      label: "Snap",
      value: 4,
      min: 0,
      max: 6,
      step: 1,
      defaultValue: 4,
      labels: ["2", "4", "8", "12", "16", "32", "Off"],
      format: (v) => {
        const d = SNAP_DIVISIONS[Math.round(v)];
        return d === 0 ? "Off" : String(d);
      },
      onChange: (v) => m.setSnap(SNAP_DIVISIONS[Math.round(v)]),
    });

    slider(transport, {
      label: "Length",
      value: 1,
      min: 1,
      max: 8,
      step: 1,
      defaultValue: 1,
      labels: ["1", "2", "3", "4", "5", "6", "7", "8"],
      format: (v) =>
        Math.round(v) + (Math.round(v) === 1 ? " bar" : " bars"),
      onChange: (v) => m.setBars(v),
    });

    this.lightEl = document.createElement("div");
    this.lightEl.className = "drum-light";
    this.lightEl.title = "Tempo indicator";
    transport.appendChild(this.lightEl);

    /* ---- Instruments ---- */
    const inst = this._group("Instruments");
    slider(inst, {
      label: "Instrument",
      value: 0,
      min: 0,
      max: 9,
      step: 1,
      defaultValue: 0,
      labels: DRUM_INSTRUMENTS.map((d) => d.short),
      format: (v) => DRUM_INSTRUMENTS[Math.round(v)].name,
      onChange: (v) => (this.selectedInst = Math.round(v)),
    });
    DRUM_INSTRUMENTS.forEach((d) => {
      const col = document.createElement("div");
      col.className = "drum-inst-col";
      inst.appendChild(col);

      knob(col, {
        label: d.short,
        value: m.levels[d.id],
        min: 0,
        max: 1,
        defaultValue: 0.8,
        size: 44,
        format: (v) => Math.round(v * 100) + "%",
        onChange: (v) => m.setLevel(d.id, v),
      });

      if (d.id === "bd") {
        knob(col, {
          label: "Tone BD",
          value: m.tones.bd,
          min: 60,
          max: 300,
          defaultValue: 120,
          size: 44,
          format: (v) => Math.round(v) + " Hz",
          onChange: (v) => m.setTone("bd", v),
        });
        knob(col, {
          label: "Decay BD",
          value: m.decays.bd,
          min: 0.1,
          max: 1.5,
          defaultValue: 0.5,
          size: 44,
          format: (v) => v.toFixed(2) + "s",
          onChange: (v) => m.setDecay("bd", v),
        });
      } else if (d.id === "sd") {
        knob(col, {
          label: "Tone SD",
          value: m.tones.sd,
          min: 1000,
          max: 8000,
          defaultValue: 3500,
          size: 44,
          format: (v) => (v / 1000).toFixed(1) + "k",
          onChange: (v) => m.setTone("sd", v),
        });
      } else if (d.id === "lt" || d.id === "mt" || d.id === "ht") {
        knob(col, {
          label: "Tune " + d.short,
          value: m.tunings[d.id],
          min: 0.5,
          max: 2,
          defaultValue: 1,
          size: 44,
          format: (v) => v.toFixed(2) + "x",
          onChange: (v) => m.setTuning(d.id, v),
        });
      } else if (d.id === "cy") {
        knob(col, {
          label: "Tone CY",
          value: m.tones.cy,
          min: 3000,
          max: 10000,
          defaultValue: 6000,
          size: 44,
          format: (v) => (v / 1000).toFixed(1) + "k",
          onChange: (v) => m.setTone("cy", v),
        });
        knob(col, {
          label: "Decay CY",
          value: m.decays.cy,
          min: 0.3,
          max: 4,
          defaultValue: 1.5,
          size: 44,
          format: (v) => v.toFixed(1) + "s",
          onChange: (v) => m.setDecay("cy", v),
        });
      } else if (d.id === "oh") {
        knob(col, {
          label: "Decay OH",
          value: m.decays.oh,
          min: 0.1,
          max: 1.5,
          defaultValue: 0.5,
          size: 44,
          format: (v) => v.toFixed(2) + "s",
          onChange: (v) => m.setDecay("oh", v),
        });
      }
    });

    /* ---- Master ---- */
    const master = this._group("Master");
    knob(master, {
      label: "Volume",
      value: m.params.master,
      min: 0,
      max: 1,
      defaultValue: 0.8,
      size: 44,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => m.setMaster(v),
    });

    /* ---- Pattern preview ---- */
    const previewGroup = this._group("Pattern");
    previewGroup.parentElement.classList.add("drum-preview-group");
    this.canvas = document.createElement("canvas");
    this.canvas.id = "drum-preview-canvas";
    this.c2d = this.canvas.getContext("2d");
    previewGroup.appendChild(this.canvas);
  }

  _button(text, extraClass) {
    const b = document.createElement("button");
    b.className = "drum-btn" + (extraClass ? " " + extraClass : "");
    b.textContent = text;
    return b;
  }

  /* ---------------- transport ---------------- */

  _togglePlay() {
    if (this.machine.playing) this.machine.stop();
    else this.machine.start();
    this.btnPlay.classList.toggle("active", this.machine.playing);
    this.btnPlay.textContent = this.machine.playing ? "Stop" : "Start";
  }

  /* ---------------- space-to-record ---------------- */

  _bindSpace() {
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur)
        document.activeElement.blur();
      if (this.recording && this.machine.playing) {
        const ph = this.machine.getPlayhead();
        if (ph !== null) this.machine.addHit(ph, this.selectedInst);
      }
    });
  }

  /* ---------------- preview canvas ---------------- */

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cw = rect.width;
    this._ch = rect.height;
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _tickFromX(x) {
    const gutter = 34;
    const plotW = this._cw - gutter;
    const t = ((x - gutter) / plotW) * this.machine.totalTicks;
    return Math.max(0, Math.min(this.machine.totalTicks, t));
  }

  _laneFromY(y) {
    const laneH = this._ch / DRUM_INSTRUMENTS.length;
    const lane = Math.floor(y / laneH);
    return lane >= 0 && lane < DRUM_INSTRUMENTS.length ? lane : -1;
  }

  _bindPreview() {
    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const p = this._pos(e);
      const lane = this._laneFromY(p.y);
      if (lane < 0) return;
      const tick = this._tickFromX(p.x);
      const plotW = this._cw - 34;
      const radius = (12 / plotW) * this.machine.totalTicks;
      let idx = this.machine.hitAt(lane, tick, radius);
      const wasExisting = idx >= 0;
      if (!wasExisting) idx = this.machine.addHit(tick, this.selectedInst);
      this._drag = { idx, startX: p.x, moved: false, wasExisting };
    });

    c.addEventListener("pointermove", (e) => {
      if (!this._drag) return;
      const p = this._pos(e);
      if (Math.abs(p.x - this._drag.startX) > 4) this._drag.moved = true;
      this.machine.moveHit(this._drag.idx, this._tickFromX(p.x));
    });

    const end = (e) => {
      if (!this._drag) return;
      if (this._drag.wasExisting && !this._drag.moved)
        this.machine.removeHit(this._drag.idx);
      this._drag = null;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  /* ---------------- render loop ---------------- */

  _loop() {
    this._updateLight();
    this._drawPreview();
    this._raf = requestAnimationFrame(this._loop);
  }

  _updateLight() {
    const ph = this.machine.getPlayhead();
    if (ph === null) {
      this._lastBeat = -1;
      return;
    }
    const beat = Math.floor(ph / 24); // 24 ticks per beat
    if (beat !== this._lastBeat) {
      this._lastBeat = beat;
      this._flash(beat % 4 === 0); // bar start every 4 beats
    }
  }

  _flash(isBar) {
    const el = this.lightEl;
    el.classList.remove("beat", "bar");
    void el.offsetWidth; // restart the transition
    el.classList.add(isBar ? "bar" : "beat");
    clearTimeout(this._lightTimer);
    this._lightTimer = setTimeout(
      () => el.classList.remove("beat", "bar"),
      110
    );
  }

  _drawPreview() {
    const ctx = this.c2d;
    const w = this._cw;
    const h = this._ch;
    if (w < 2 || h < 2) return;
    ctx.clearRect(0, 0, w, h);

    const gutter = 34;
    const plotW = w - gutter;
    const laneH = h / DRUM_INSTRUMENTS.length;
    const total = this.machine.totalTicks;

    // lanes + labels
    for (let i = 0; i < DRUM_INSTRUMENTS.length; i++) {
      const y = i * laneH;
      if (i === this.selectedInst) {
        ctx.fillStyle = "rgba(79,209,197,0.10)";
        ctx.fillRect(gutter, y, plotW, laneH);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(gutter, y + laneH - 0.5);
      ctx.lineTo(w, y + laneH - 0.5);
      ctx.stroke();
      ctx.fillStyle = i === this.selectedInst ? "#4fd1c5" : "#8b93a3";
      ctx.font = "9px Inter, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(DRUM_INSTRUMENTS[i].short, 4, y + laneH / 2);
    }

    // grid: 16ths faint, beats medium, bars strong
    const tick16 = TICKS_PER_BAR / 16;
    for (let t = 0; t <= total; t += tick16) {
      const x = gutter + (t / total) * plotW;
      const isBar = t % TICKS_PER_BAR === 0;
      const isBeat = t % 24 === 0;
      ctx.strokeStyle = isBar
        ? "rgba(255,255,255,0.25)"
        : isBeat
        ? "rgba(255,255,255,0.12)"
        : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }

    // hits
    const rw = Math.max(6, (plotW / total) * 0.8);
    for (const hit of this.machine.hits) {
      const x = gutter + (hit.t / total) * plotW;
      const y = hit.inst * laneH;
      ctx.fillStyle = "#4fd1c5";
      ctx.fillRect(x - rw / 2, y + laneH * 0.25, rw, laneH * 0.5);
    }

    // playhead
    const ph = this.machine.getPlayhead();
    if (ph !== null) {
      const x = gutter + (ph / total) * plotW;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}

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
    this._widgets = {};
    const knob = (row, opts, key) => {
      const k = new Knob(opts);
      row.appendChild(k.wrap);
      if (key) this._widgets[key] = k;
      return k;
    };
    const slider = (row, opts, key) => {
      const s = new Slider(opts);
      row.appendChild(s.wrap);
      if (key) this._widgets[key] = s;
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
    }, "tempo");
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
    }, "snap");

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
    }, "bars");

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
    }, "instrument");
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
      }, "level_" + d.id);

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
        }, "tone_bd");
        knob(col, {
          label: "Decay BD",
          value: m.decays.bd,
          min: 0.1,
          max: 1.5,
          defaultValue: 0.5,
          size: 44,
          format: (v) => v.toFixed(2) + "s",
          onChange: (v) => m.setDecay("bd", v),
        }, "decay_bd");
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
        }, "tone_sd");
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
        }, "tune_" + d.id);
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
        }, "tone_cy");
        knob(col, {
          label: "Decay CY",
          value: m.decays.cy,
          min: 0.3,
          max: 4,
          defaultValue: 1.5,
          size: 44,
          format: (v) => v.toFixed(1) + "s",
          onChange: (v) => m.setDecay("cy", v),
        }, "decay_cy");
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
        }, "decay_oh");
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
    }, "master");

    /* ---- Pattern preview ---- */
    const previewRow = this._group("Pattern");
    const previewGroup = previewRow.parentElement;
    previewGroup.classList.add("drum-preview-group");

    // Header row: title (left) + menu button (right)
    const h2 = previewGroup.querySelector("h2");
    this.patternTitle = h2;
    const header = document.createElement("div");
    header.className = "drum-pattern-header";
    previewGroup.insertBefore(header, previewRow);
    header.appendChild(h2);

    this.btnMenu = document.createElement("button");
    this.btnMenu.className = "drum-btn drum-menu-btn";
    this.btnMenu.textContent = "⋯";
    this.btnMenu.title = "Pattern menu";
    header.appendChild(this.btnMenu);

    // Dropdown: name field + Save / Load
    this.menu = document.createElement("div");
    this.menu.className = "drum-menu";
    this.menu.style.display = "none";

    this.nameInput = document.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.className = "drum-name-input";
    this.nameInput.placeholder = "Pattern name";
    this.nameInput.value = "untitled";
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener("input", () => this._updatePatternTitle());
    this.menu.appendChild(this.nameInput);

    this.btnSave = this._button("Save", "save");
    this.btnSave.addEventListener("click", () => {
      this._save();
      this._closeMenu();
      this.btnSave.blur();
    });
    this.menu.appendChild(this.btnSave);

    this.btnLoad = this._button("Load");
    this.btnLoad.addEventListener("click", () => {
      this._load();
      this._closeMenu();
      this.btnLoad.blur();
    });
    this.menu.appendChild(this.btnLoad);

    document.body.appendChild(this.menu);

    this.btnMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggleMenu();
      this.btnMenu.blur();
    });
    this.menu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => this._closeMenu());
    window.addEventListener("resize", () => this._closeMenu());
    window.addEventListener("scroll", () => this._closeMenu(), true);

    this.canvas = document.createElement("canvas");
    this.canvas.id = "drum-preview-canvas";
    this.c2d = this.canvas.getContext("2d");
    previewRow.appendChild(this.canvas);
  }

  _toggleMenu() {
    const open = this.menu.style.display !== "none";
    if (open) {
      this._closeMenu();
      return;
    }
    const r = this.btnMenu.getBoundingClientRect();
    this.menu.style.display = "block";
    const mw = this.menu.offsetWidth;
    const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    this.menu.style.left = left + "px";
    this.menu.style.top = r.bottom + 6 + "px";
    this.btnMenu.classList.add("active");
    this.nameInput.focus();
  }

  _closeMenu() {
    this.menu.style.display = "none";
    this.btnMenu.classList.remove("active");
  }

  /** Show the pattern name as the group title when set, else "Pattern". */
  _updatePatternTitle() {
    const name = (this.nameInput.value || "").trim();
    this.patternTitle.textContent = name || "Pattern";
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

  /* ---------------- save / load ---------------- */

  /** Push machine state into all retained widgets without firing onChange. */
  _syncWidgetsFromMachine() {
    const m = this.machine;
    const w = this._widgets;
    if (!w) return;
    if (w.tempo) w.tempo.setValue(m.params.tempo, false);
    if (w.snap) {
      const idx = SNAP_DIVISIONS.indexOf(m.params.snap);
      if (idx >= 0) w.snap.setValue(idx, false);
    }
    if (w.bars) w.bars.setValue(m.params.bars, false);
    if (w.master) w.master.setValue(m.params.master, false);
    for (const d of DRUM_INSTRUMENTS) {
      const lv = w["level_" + d.id];
      if (lv) lv.setValue(m.levels[d.id], false);
    }
    for (const id of ["bd", "sd", "cy"]) {
      const tk = w["tone_" + id];
      if (tk) tk.setValue(m.tones[id], false);
    }
    for (const id of ["lt", "mt", "ht"]) {
      const tk = w["tune_" + id];
      if (tk) tk.setValue(m.tunings[id], false);
    }
    for (const id of ["bd", "cy", "oh"]) {
      const dk = w["decay_" + id];
      if (dk) dk.setValue(m.decays[id], false);
    }
  }

  _save() {
    const data = this.machine.serialize();
    data.name = (this.nameInput.value || "").trim() || "untitled";
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    a.download =
      "drum-pattern-" +
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      ".json";
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  _load() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        this.machine.restore(data);
        this.nameInput.value =
          (typeof data.name === "string" && data.name.trim()) || "untitled";
        this._updatePatternTitle();
        this._syncWidgetsFromMachine();
      } catch (err) {
        alert("Could not load pattern:\n" + (err && err.message ? err.message : err));
      }
    });
    input.click();
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

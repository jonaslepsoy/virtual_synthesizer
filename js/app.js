/**
 * App — builds the control panel and wires the knobs to the AudioEngine.
 */
(function () {
  const engine = new AudioEngine();
  const panel = document.getElementById("controls");

  const groups = [];
  function group(title) {
    const el = document.createElement("section");
    el.className = "control-group";
    const h = document.createElement("h2");
    h.textContent = title;
    el.appendChild(h);
    const row = document.createElement("div");
    row.className = "knob-row";
    el.appendChild(row);
    panel.appendChild(el);
    groups.push(row);
    return row;
  }

  function knob(row, opts) {
    const k = new Knob(opts);
    row.appendChild(k.wrap);
    return k;
  }

  function slider(row, opts) {
    const s = new Slider(opts);
    row.appendChild(s.wrap);
    return s;
  }

  const p = engine.params;

  /* ---------- Oscillator ---------- */
  const oscRow = group("Oscillator");
  slider(oscRow, {
    label: "Waveform",
    value: p.waveform,
    min: 0,
    max: 4,
    step: 1,
    defaultValue: 0,
    labels: ["Sine", "Sqr", "Saw", "Tri", "Sup"],
    format: (v) => WAVEFORMS[Math.round(v)],
    onChange: (v) => (p.waveform = Math.round(v)),
  });

  /* ---------- ADSR ---------- */
  const adsrRow = group("ADSR");
  knob(adsrRow, {
    label: "Attack",
    value: p.attack,
    min: 0.001,
    max: 1,
    defaultValue: 0.01,
    format: (v) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s"),
    onChange: (v) => (p.attack = v),
  });
  knob(adsrRow, {
    label: "Decay",
    value: p.decay,
    min: 0.001,
    max: 2,
    defaultValue: 0.2,
    format: (v) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s"),
    onChange: (v) => (p.decay = v),
  });
  knob(adsrRow, {
    label: "Sustain",
    value: p.sustain,
    min: 0,
    max: 1,
    defaultValue: 0.7,
    format: (v) => Math.round(v * 100) + "%",
    onChange: (v) => (p.sustain = v),
  });
  knob(adsrRow, {
    label: "Release",
    value: p.release,
    min: 0.01,
    max: 4,
    defaultValue: 0.4,
    format: (v) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s"),
    onChange: (v) => (p.release = v),
  });

  /* ---------- Vibrato ---------- */
  const vibRow = group("Vibrato");
  knob(vibRow, {
    label: "Rate",
    value: p.vibRate,
    min: 0.5,
    max: 12,
    defaultValue: 5.5,
    format: (v) => v.toFixed(1) + " Hz",
    onChange: (v) => (p.vibRate = v),
  });
  knob(vibRow, {
    label: "Depth",
    value: p.vibDepth,
    min: 0,
    max: 100,
    defaultValue: 0,
    format: (v) => Math.round(v) + " ct",
    onChange: (v) => (p.vibDepth = v),
  });

  /* ---------- Filters ---------- */
  const fmtHz = (v) =>
    v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : Math.round(v) + " Hz";

  const hpRow = group("High-Pass Filter");
  knob(hpRow, {
    label: "Cutoff",
    value: p.hpCutoff,
    min: 20,
    max: 8000,
    defaultValue: 20,
    format: fmtHz,
    onChange: (v) => (p.hpCutoff = v),
  });
  knob(hpRow, {
    label: "Resonance",
    value: p.hpRes,
    min: 0,
    max: 20,
    defaultValue: 0.5,
    format: (v) => v.toFixed(1),
    onChange: (v) => (p.hpRes = v),
  });

  const lpRow = group("Low-Pass Filter");
  knob(lpRow, {
    label: "Cutoff",
    value: p.lpCutoff,
    min: 100,
    max: 18000,
    defaultValue: 18000,
    format: fmtHz,
    onChange: (v) => (p.lpCutoff = v),
  });
  knob(lpRow, {
    label: "Resonance",
    value: p.lpRes,
    min: 0,
    max: 20,
    defaultValue: 0.5,
    format: (v) => v.toFixed(1),
    onChange: (v) => (p.lpRes = v),
  });

  const bpRow = group("Band-Pass Filter");
  knob(bpRow, {
    label: "Cutoff",
    value: p.bpCutoff,
    min: 100,
    max: 18000,
    defaultValue: 12000,
    format: fmtHz,
    onChange: (v) => (p.bpCutoff = v),
  });
  knob(bpRow, {
    label: "Resonance",
    value: p.bpRes,
    min: 0,
    max: 20,
    defaultValue: 0.5,
    format: (v) => v.toFixed(1),
    onChange: (v) => (p.bpRes = v),
  });

  /* ---------- Piano ---------- */
  const canvas = document.getElementById("piano");
  const piano = new Piano(canvas, {
    onNoteOn: (midi) => engine.noteOn(midi),
    onNoteOff: (midi) => engine.noteOff(midi),
    baseOctave: 3,
  });

  const kbRow = group("Keyboard");
  slider(kbRow, {
    label: "Base Octave",
    value: 3,
    min: 1,
    max: 7,
    step: 1,
    defaultValue: 3,
    labels: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
    format: (v) => "C" + Math.round(v),
    onChange: (v) => piano.setBaseOctave(v),
  });

  /* ---------- Output ---------- */
  const outRow = group("Output");
  slider(outRow, {
    label: "Volume",
    value: p.volume,
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.8,
    showValue: false,
    showTicks: false,
    onChange: (v) => engine.setVolume(v),
  });

  /* ---------- Arpeggio ---------- */
  const arpRow = group("Arpeggio");
  slider(arpRow, {
    label: "Mode",
    value: p.arpMode,
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 0,
    labels: ["Off", "Maj", "Min"],
    format: (v) => ["Off", "Major", "Minor"][Math.round(v)],
    onChange: (v) => (p.arpMode = Math.round(v)),
  });
  knob(arpRow, {
    label: "Rate",
    value: p.arpRate,
    min: 4,
    max: 128,
    step: 1,
    defaultValue: 30,
    format: (v) => Math.round(v) + " n/s",
    onChange: (v) => (p.arpRate = v),
  });


  /* ---------- Drum machine ---------- */
  new DrumPanel(document.getElementById("drum-machine"), engine);
})();

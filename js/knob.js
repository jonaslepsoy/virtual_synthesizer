/**
 * Knob — a rotary control rendered on a small canvas.
 *
 * Interaction:
 *  - vertical drag  : change value (shift = fine)
 *  - wheel          : fine-tune
 *  - double-click   : reset to default
 */
class Knob {
  constructor({
    label,
    value,
    min = 0,
    max = 1,
    step = 0,
    defaultValue,
    format = (v) => v.toFixed(2),
    onChange,
    size = 56,
  }) {
    this.label = label;
    this.size = size;
    this.min = min;
    this.max = max;
    this.step = step;
    this.defaultValue = defaultValue !== undefined ? defaultValue : value;
    this.format = format;
    this.onChange = onChange || (() => {});

    this.value = this._clamp(value);

    this.canvas = document.createElement("canvas");
    this.canvas.width = size * 2; // 2x for crisp rendering
    this.canvas.height = size * 2;
    this.canvas.style.width = size + "px";
    this.canvas.style.height = size + "px";

    this.labelEl = document.createElement("div");
    this.labelEl.className = "knob-label";
    this.labelEl.textContent = label;

    this.valueEl = document.createElement("div");
    this.valueEl.className = "knob-value";

    this.wrap = document.createElement("div");
    this.wrap.className = "knob";
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.labelEl);
    this.wrap.appendChild(this.valueEl);

    this._dragging = false;
    this._bindEvents();
    this._render();
  }

  /* ---------------- public API ---------------- */

  setValue(v, fire = true) {
    const next = this._clamp(v);
    if (next === this.value) return;
    this.value = next;
    this._render();
    if (fire) this.onChange(this.value);
  }

  reset() {
    this.setValue(this.defaultValue);
  }

  /* ---------------- internals ---------------- */

  _clamp(v) {
    let x = Math.min(this.max, Math.max(this.min, v));
    if (this.step > 0) {
      x = Math.round((x - this.min) / this.step) * this.step + this.min;
    }
    return x;
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._dragging = true;
      this._lastY = e.clientY;
      this._lastFine = e.shiftKey;
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener("pointermove", (e) => {
      if (!this._dragging) return;
      const dy = this._lastY - e.clientY;
      this._lastY = e.clientY;
      const fine = e.shiftKey || this._lastFine;
      const range = this.max - this.min;
      const delta = (range / 200) * (fine ? 0.15 : 1) * dy;
      this.setValue(this.value + delta);
    });

    const endDrag = (e) => {
      this._dragging = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
    };
    c.addEventListener("pointerup", endDrag);
    c.addEventListener("pointercancel", endDrag);

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const range = this.max - this.min;
        const delta = (range / 100) * (e.shiftKey ? 0.15 : 1) * -Math.sign(e.deltaY);
        this.setValue(this.value + delta);
      },
      { passive: false }
    );

    c.addEventListener("dblclick", () => this.reset());
  }

  _render() {
    const ctx = this.canvas.getContext("2d");
    const S = 112; // logical drawing space (scaled to the actual canvas)
    const cx = S / 2;
    const cy = S / 2;
    const r = 40;

    const scale = (this.size * 2) / S;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // track (full sweep)
    const start = 135 * (Math.PI / 180);
    const sweep = 270 * (Math.PI / 180);
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a303b";
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + sweep);
    ctx.stroke();

    // value arc
    const t =
      this.max === this.min
        ? 0
        : (this.value - this.min) / (this.max - this.min);
    if (t > 0.001) {
      ctx.strokeStyle = "#4fd1c5";
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + sweep * t);
      ctx.stroke();
    }

    // knob body
    const grad = ctx.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, 34);
    grad.addColorStop(0, "#3a4150");
    grad.addColorStop(1, "#1c2029");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0c0e12";
    ctx.lineWidth = 2;
    ctx.stroke();

    // pointer
    const angle = start + sweep * t;
    ctx.strokeStyle = "#e6e9ef";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 12, cy + Math.sin(angle) * 12);
    ctx.lineTo(cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24);
    ctx.stroke();

    this.valueEl.textContent = this.format(this.value);
  }
}

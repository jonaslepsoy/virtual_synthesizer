/**
 * Slider — a vertical fader switch for controls with a few discrete settings.
 *
 * Styled after a 70s music control board fader: a recessed groove with a
 * metal cap that slides up and down, tick marks and short labels for each
 * position.
 *
 * Interaction:
 *  - click / drag on the track : move to position (snaps to step)
 *  - wheel                    : step up / down
 *  - double-click             : reset to default
 */

// Geometry (must match the .slider-* rules in css/style.css)
const SLIDER_TRACK_H = 72;
const SLIDER_CAP_H = 16;
const SLIDER_TRAVEL = SLIDER_TRACK_H - SLIDER_CAP_H;

class Slider {
  constructor({
    label,
    value,
    min = 0,
    max = 1,
    step = 1,
    defaultValue,
    labels,
    format = (v) => String(v),
    onChange,
    showValue = true,
    showTicks = true,
  }) {
    this.label = label;
    this.min = min;
    this.max = max;
    this.step = step;
    this.defaultValue = defaultValue !== undefined ? defaultValue : value;
    this.labels = labels || null;
    this.format = format;
    this.onChange = onChange || (() => {});
    this.showValue = showValue;
    this.showTicks = showTicks;

    this.value = this._clamp(value);

    this.wrap = document.createElement("div");
    this.wrap.className = "slider";

    this.labelEl = document.createElement("div");
    this.labelEl.className = "slider-label";
    this.labelEl.textContent = label;

    this.body = document.createElement("div");
    this.body.className = "slider-body";

    this.ticksEl = document.createElement("div");
    this.ticksEl.className = "slider-ticks";

    this.track = document.createElement("div");
    this.track.className = "slider-track";

    this.fill = document.createElement("div");
    this.fill.className = "slider-fill";

    this.cap = document.createElement("div");
    this.cap.className = "slider-cap";

    this.track.appendChild(this.fill);
    this.track.appendChild(this.cap);
    this.body.appendChild(this.ticksEl);
    this.body.appendChild(this.track);

    this.valueEl = document.createElement("div");
    this.valueEl.className = "slider-value";
    if (!showValue) this.valueEl.style.display = "none";

    this.wrap.appendChild(this.labelEl);
    this.wrap.appendChild(this.body);
    this.wrap.appendChild(this.valueEl);

    this._buildTicks();
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

  _stepIndex(v) {
    return Math.round((v - this.min) / this.step);
  }

  _buildTicks() {
    if (!this.showTicks) {
      this.tickEls = [];
      return;
    }
    const count = this._stepIndex(this.max) + 1;
    this.tickEls = [];
    for (let i = 0; i < count; i++) {
      const v = this.min + i * this.step;
      const t = (v - this.min) / (this.max - this.min);
      const el = document.createElement("div");
      el.className = "slider-tick";
      el.style.top = ((1 - t) * SLIDER_TRAVEL + SLIDER_CAP_H / 2) + "px";
      const text = this.labels
        ? this.labels[i]
        : this.format(v);
      el.textContent = text;
      this.ticksEl.appendChild(el);
      this.tickEls.push(el);
    }
  }

  _bindEvents() {
    const t = this.track;

    t.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._dragging = true;
      t.setPointerCapture(e.pointerId);
      this._setFromPointer(e);
    });

    t.addEventListener("pointermove", (e) => {
      if (this._dragging) this._setFromPointer(e);
    });

    const endDrag = (e) => {
      this._dragging = false;
      try {
        t.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
    };
    t.addEventListener("pointerup", endDrag);
    t.addEventListener("pointercancel", endDrag);

    t.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = -Math.sign(e.deltaY);
        if (dir !== 0) this.setValue(this.value + dir * this.step);
      },
      { passive: false }
    );

    t.addEventListener("dblclick", () => this.reset());
  }

  _setFromPointer(e) {
    const rect = this.track.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const t = Math.min(1, Math.max(0, y / SLIDER_TRAVEL));
    this.setValue(this.min + (1 - t) * (this.max - this.min));
  }

  _render() {
    const t =
      this.max === this.min
        ? 0
        : (this.value - this.min) / (this.max - this.min);
    this.cap.style.top = (1 - t) * SLIDER_TRAVEL + "px";
    this.fill.style.height =
      t * SLIDER_TRAVEL + SLIDER_CAP_H / 2 + "px";
    this.valueEl.textContent = this.format(this.value);

    const idx = this._stepIndex(this.value);
    this.tickEls.forEach((el, i) =>
      el.classList.toggle("active", i === idx)
    );
  }
}

// Magik Duration - frontend for the MagikDuration node.
//
// Ported in spirit from Pixaroma's Duration node (ComfyUI-Pixaroma, MIT
// License, Copyright (c) 2026 pixaroma), rewritten self-contained: no shared
// framework, plain widgets are the source of truth, this file only adds sugar.
//
// What it adds on top of the plain widgets:
//   - a recipe dropdown that COPIES its numbers onto the fps/step/plus/min
//     widgets (a picker, not config: saved workflows never change retroactively)
//   - quick duration chips (default 3/5/10 s, double-click the row to edit)
//   - a live preview line: "124 frames · 5.17 s" before you run
//
// The maths here is a mirror of duration_helpers.py: same clamps, same
// round-half-to-EVEN, same non-negative modulo. Python stays the authority.

import { app } from "../../scripts/app.js";

const CLASS = "MagikDuration";
const STYLE_ID = "magik-duration-style";

const RECIPES = {
  "MiniMax H3": { fps: 24, step: 17, plus: 5, min_frames: 5 },
  "Wan 2.x": { fps: 16, step: 4, plus: 1, min_frames: 1 },
  "Hunyuan": { fps: 24, step: 4, plus: 1, min_frames: 1 },
  "LTX": { fps: 24, step: 8, plus: 1, min_frames: 1 },
  "Plain frames": { fps: 24, step: 1, plus: 0, min_frames: 1 },
};

const DEFAULT_CHIPS = [3, 5, 10];

// ── browser mirror of duration_helpers.py ───────────────────────────────────

function mod(value, n) { return ((value % n) + n) % n; }

function num(value, fallback, lo, hi) {
  const out = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.max(lo, Math.min(hi, out));
}

// Python's round() is banker's rounding: round(2.5) is 2, Math.round gives 3.
function pyRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function snapFrames(raw, step, plus) {
  step = Math.trunc(step); plus = Math.trunc(plus); raw = Math.trunc(raw);
  if (step <= 1) return raw;
  const remainder = mod(raw - plus, step);
  return remainder ? raw + (step - remainder) : raw;
}

function framesFromSeconds(seconds, fps, step, plus, minFrames) {
  seconds = num(seconds, 5, -100000, 100000);
  fps = num(fps, 24, 0, 1000);
  step = Math.trunc(num(step, 17, 0, 100000));
  plus = Math.trunc(num(plus, 5, 0, 100000));
  minFrames = Math.trunc(num(minFrames, 5, 0, 1000000));
  let raw = pyRound(seconds * fps);
  if (raw < minFrames) raw = minFrames;
  raw = snapFrames(raw, step, plus);
  return Math.max(0, Math.min(1000000, raw));
}

/** The frames Python would send, from the node's widget values. */
function previewFrames(node) {
  const w = widgetValues(node);
  const frames = framesFromSeconds(
    w.seconds, w.fps, w.step, w.plus, w.min_frames
  );
  const fps = num(w.fps, 24, 0, 1000);
  return { frames, actual: fps > 0 ? frames / fps : 0 };
}

function widgetValues(node) {
  const byName = {};
  for (const widget of node.widgets || []) byName[widget.name] = widget;
  const get = (name, fallback) => {
    const w = byName[name];
    if (!w) return fallback;
    const v = w.value;
    return v === undefined || v === null || v === "" ? fallback : v;
  };
  return {
    recipe: get("recipe", "Manual"),
    seconds: get("seconds", 5),
    fps: get("fps", 24),
    step: get("step", 17),
    plus: get("plus", 5),
    min_frames: get("min_frames", 5),
    formula: get("formula", ""),
  };
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function injectCSS() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .magik-duration-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
    .magik-duration-chips button {
      background: var(--comfy-menu-bg, #2a2a2a);
      color: var(--input-text, #ddd);
      border: 1px solid var(--border-color, #444);
      border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer;
    }
    .magik-duration-chips button.magik-active {
      background: var(--comfy-input-bg-hover, #4a6);
      color: #fff; border-color: var(--comfy-input-bg-hover, #4a6);
    }
    .magik-duration-preview {
      padding: 2px 0 4px 0; font-size: 12px; opacity: 0.85;
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    }
    .magik-duration-preview b { font-variant-numeric: tabular-nums; }
    .magik-duration-preview .magik-warn { color: #e6a23c; }
  `;
  document.head.appendChild(style);
}

// ── DOM widgets ─────────────────────────────────────────────────────────────

function setWidgetValue(node, name, value) {
  const widget = node.widgets?.find((w) => w.name === name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value);
  app.graph?.setDirtyCanvas?.(true, true);
}

function chipsFor(node) {
  const list = node.properties?.magik_duration_chips;
  return Array.isArray(list) && list.length
    ? list.filter((x) => Number.isFinite(parseFloat(x)))
    : [...DEFAULT_CHIPS];
}

function addChipsWidget(node) {
  const element = document.createElement("div");
  element.className = "magik-duration-chips";
  const widget = node.addDOMWidget("magik_duration_chips", "magik_duration_chips", element, {
    getValue: () => chipsFor(node).map((v) => ({ type: "duration", value: v })),
    setValue: () => {},
    hideOnZoom: false,
  });
  widget.serializeValue = () => undefined;   // DOM only, never saved in the widget

  const render = () => {
    const chips = chipsFor(node);
    const seconds = parseFloat(widgetValues(node).seconds);
    element.innerHTML = "";
    for (const chip of chips) {
      const btn = document.createElement("button");
      btn.textContent = chip + " s";
      if (Math.abs(chip - seconds) < 1e-9) btn.className = "magik-active";
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        setWidgetValue(node, "seconds", chip);
        syncRecipeFromNumbers(node, chip);
      });
      element.appendChild(btn);
    }
    const edit = document.createElement("button");
    edit.textContent = "⋯";
    edit.title = "Double-click the row, or here: edit the quick durations";
    edit.addEventListener("dblclick", (e) => {
      e.preventDefault(); e.stopPropagation();
      askChips(node, render);
    });
    element.appendChild(edit);
  };
  element.addEventListener("dblclick", (e) => {
    e.preventDefault(); e.stopPropagation();
    askChips(node, render);
  });
  widget.renderChips = render;
  render();
  return widget;
}

function askChips(node, onChange) {
  const current = chipsFor(node).join(", ");
  const text = window.prompt(
    "Quick durations (seconds, comma separated):", current
  );
  if (text === null) return;
  const list = text.split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!list.length) return;
  node.properties = node.properties || {};
  node.properties.magik_duration_chips = list;
  onChange();
}

function addPreviewWidget(node) {
  const element = document.createElement("div");
  element.className = "magik-duration-preview";
  const widget = node.addDOMWidget("magik_duration_preview", "magik_duration_preview", element, {
    getValue: () => undefined,
    setValue: () => {},
    hideOnZoom: false,
  });
  widget.serializeValue = () => undefined;

  const render = () => {
    const w = widgetValues(node);
    const { frames, actual } = previewFrames(node);
    const picked = parseFloat(w.seconds);
    const custom =
      w.recipe === "Custom formula" && String(w.formula || "").trim() !== "";
    let html = `<span><b>${frames}</b> frames · <b>${actual.toFixed(2)}</b> s</span>`;
    if (Math.abs(actual - picked) > 0.005) {
      html += `<span class="magik-warn">snapped: ${picked} s → ${actual.toFixed(2)} s</span>`;
    }
    if (custom) {
      html += `<span class="magik-warn">formula is checked by Python at run time</span>`;
    }
    element.innerHTML = html;
  };
  widget.renderPreview = render;
  render();
  return widget;
}

// ── recipe picker ────────────────────────────────────────────────────────────

function syncRecipeFromNumbers(node, newSeconds) {
  // Selecting a recipe copies its numbers; editing a number by hand flips the
  // recipe to Manual so the dropdown never lies about what will run.
  const w = widgetValues(node);
  if (w.recipe === "Custom formula" || w.recipe === "Manual") return;
  const r = RECIPES[w.recipe];
  if (!r) return;
  const same =
    num(w.fps, 24, 0, 1000) === r.fps &&
    Math.trunc(num(w.step, 17, 0, 100000)) === r.step &&
    Math.trunc(num(w.plus, 5, 0, 100000)) === r.plus &&
    Math.trunc(num(w.min_frames, 5, 0, 1000000)) === r.min_frames;
  if (!same) setWidgetValue(node, "recipe", "Manual");
}

function hideAdvanced(node) {
  // fps/step/plus/min_frames/formula live behind the recipe dropdown; hide the
  // raw numbers unless the recipe actually needs them.
  const recipe = widgetValues(node).recipe;
  const showAdvanced = recipe === "Manual" || recipe === "Custom formula";
  for (const name of ["fps", "step", "plus", "min_frames", "formula"]) {
    const widget = node.widgets?.find((w) => w.name === name);
    if (!widget) continue;
    if (widget._magikOriginalType === undefined) {
      widget._magikOriginalType = widget.type;
    }
    widget.type = showAdvanced ? widget._magikOriginalType : "hidden";
    if (widget.element) widget.element.style.display = showAdvanced ? "" : "none";
  }
  node.setDirtyCanvas?.(true, true);
  // recalc layout to the new visible widget count
  node.setSize?.(node.computeSize?.());
}

function wireWidgets(node) {
  const recipeWidget = node.widgets?.find((w) => w.name === "recipe");
  if (recipeWidget && !recipeWidget._magikWired) {
    recipeWidget._magikWired = true;
    const orig = recipeWidget.callback;
    recipeWidget.callback = (value) => {
      orig?.(value);
      const r = RECIPES[value];
      if (r) {
        setWidgetValue(node, "fps", r.fps);
        setWidgetValue(node, "step", r.step);
        setWidgetValue(node, "plus", r.plus);
        setWidgetValue(node, "min_frames", r.min_frames);
      }
      hideAdvanced(node);
      repaintExtras(node);
    };
  }
  for (const name of ["seconds", "fps", "step", "plus", "min_frames", "formula"]) {
    const widget = node.widgets?.find((w) => w.name === name);
    if (!widget || widget._magikWired) continue;
    widget._magikWired = true;
    const orig = widget.callback;
    widget.callback = (value) => {
      orig?.(value);
      if (["fps", "step", "plus", "min_frames"].includes(name)) {
        // editing a number by hand flips the recipe dropdown to Manual
        syncRecipeFromNumbers(node, value);
      }
      hideAdvanced(node);
      repaintExtras(node);
    };
  }
}

function repaintExtras(node) {
  const chips = node.widgets?.find((w) => w.name === "magik_duration_chips");
  const preview = node.widgets?.find((w) => w.name === "magik_duration_preview");
  chips?.renderChips?.();
  preview?.renderPreview?.();
}

// keep the face fresh whenever the user types without every widget firing a
// callback: one cheap draw hook.
function patchOnDraw(nodeType) {
  const _draw = nodeType.prototype.onDrawForeground;
  let last = null;
  nodeType.prototype.onDrawForeground = function (ctx) {
    if (this._magikExtras) {
      const key = JSON.stringify(widgetValues(this));
      if (key !== last) { last = key; repaintExtras(this); }
    }
    return _draw?.apply(this, arguments);
  };
}

// ── registration ────────────────────────────────────────────────────────────

app.registerExtension({
  name: "Magik.Duration",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._magikDurationPatched) return;
    nodeType.prototype._magikDurationPatched = true;

    injectCSS();
    patchOnDraw(nodeType);

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      wireWidgets(this);
      this._magikExtras = true;
      addChipsWidget(this);
      addPreviewWidget(this);
      hideAdvanced(this);
      queueMicrotask(() => { repaintExtras(this); hideAdvanced(this); });
      return r;
    };

    const _configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configured?.apply(this, arguments);
      hideAdvanced(this);
      queueMicrotask(() => { repaintExtras(this); hideAdvanced(this); });
      return r;
    };
  },
});

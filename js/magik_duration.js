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
//   - a live preview line: "5 s → 124 frames (really 5.17 s)" before you run
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

function fmt(value, places = 2) {
  return String(Math.round(value * 10 ** places) / 10 ** places);
}

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
    .magik-duration-chips {
      display: flex; align-items: center; gap: 4px; padding: 4px 0;
      flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; overflow: hidden;
    }
    .magik-duration-chips .magik-chip {
      flex: 1 1 auto; min-width: 28px; box-sizing: border-box;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
      border-radius: 4px; color: rgba(255,255,255,0.72);
      font-size: 12px; padding: 4px 6px; cursor: pointer; text-align: center; line-height: 1.1;
    }
    .magik-duration-chips .magik-chip:hover { border-color: var(--magik-acc, #f66744); color: #ddd; }
    .magik-duration-chips .magik-chip.magik-active,
    .magik-duration-chips .magik-chip.magik-active:hover {
      background: var(--magik-acc, #f66744); border-color: var(--magik-acc, #f66744); color: #fff;
    }
    .magik-duration-chips .magik-gear {
      flex: none; width: 16px; height: 16px; padding: 0; margin: 0; line-height: 0;
      background: none; border: none; cursor: pointer; color: #bbb;
    }
    .magik-duration-chips .magik-gear:hover { color: var(--magik-acc, #f66744); }
    .magik-duration-chips .magik-gear svg { display: block; width: 14px; height: 14px; fill: currentColor; }
    .magik-duration-preview {
      min-height: 18px; display: flex; align-items: center; gap: 5px;
      padding: 2px 0 4px 0; font-size: 11px; color: var(--magik-acc, #f66744);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .magik-duration-preview .magik-dim { color: rgba(255,255,255,0.42); }
    .magik-duration-preview .magik-warn { color: #e8694a; }
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
      btn.className = "magik-chip" + (Math.abs(chip - seconds) < 1e-9 ? " magik-active" : "");
      btn.textContent = fmt(chip) + "s";
      btn.title = `Set the length to ${fmt(chip)} s`;
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        setWidgetValue(node, "seconds", chip);
        syncRecipeFromNumbers(node, chip);
      });
      element.appendChild(btn);
    }
    const gear = document.createElement("button");
    gear.className = "magik-gear";
    gear.title = "Edit the quick durations";
    gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';
    gear.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      askChips(node, render);
    });
    element.appendChild(gear);
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
    element.textContent = "";
    const main = document.createElement("span");
    main.textContent = `${fmt(picked)} s → ${frames} frames`;
    element.appendChild(main);
    if (Math.abs(actual - picked) > 0.005) {
      const dim = document.createElement("span");
      dim.className = "magik-dim";
      dim.textContent = `(really ${fmt(actual)} s)`;
      element.appendChild(dim);
    }
    if (custom) {
      const warn = document.createElement("span");
      warn.className = "magik-warn";
      warn.textContent = "formula is checked by Python at run time";
      element.appendChild(warn);
    }
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
  // recalc layout to the new visible widget count; height only grows to the
  // minimum, never clamps down a node the user resized taller
  const min = node.computeSize?.();
  if (min) {
    node.setSize?.([min[0], Math.max(node.size?.[1] ?? min[1], min[1])]);
  }
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

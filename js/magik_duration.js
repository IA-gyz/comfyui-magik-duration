// Magik Duration - frontend for the MagikDuration node.
//
// Ported in spirit from Pixaroma's Duration node (ComfyUI-Pixaroma, MIT
// License, Copyright (c) 2026 pixaroma), rewritten self-contained: no shared
// framework, plain widgets are the source of truth, this file only adds sugar.
//
// What it adds on top of the plain widgets:
//   - a recipe dropdown that COPIES its numbers onto the fps/step/plus/min
//     widgets (a picker, not config: saved workflows never change retroactively)
//   - quick duration chips (default 3/5/10 s; the gear opens a settings panel)
//   - a live preview line: "5 s → 124 frames (really 5.17 s)" before you run
//
// The maths here is a mirror of duration_helpers.py: same clamps, same
// round-half-to-EVEN, same non-negative modulo. Python stays the authority.

// Self-contained on purpose: one file, no sibling imports, so a missing or
// stale second file can never stop the extension from loading. The marked
// block below mirrors duration_helpers.py for the live preview; Python stays
// the authority, and tests/test_parity.py extracts that block and compares it
// with Python over thousands of inputs.

import { app } from "../../scripts/app.js";

const CLASS = "MagikDuration";

// The frontend draws DOM widgets in a layer above the canvas and gives every
// node corner a square resize grab zone (LGraphNode.resizeHandleSize, 15px;
// resizeEdgeSize, 5px for the sides). A DOM widget's wrapper covers its whole
// box, so one that reaches into a corner makes it ungrabbable. The box is the
// row inset by the widget's `margin` on all four sides, and the chips row runs
// to the very bottom of the node, so its margin must be at least the corner
// zone. A row's real content height is (row height - 2 x margin), which is why
// the declared row heights below add the margins back.
const LG = window.LiteGraph?.LGraphNode;
const CORNER = Math.ceil(LG?.resizeHandleSize ?? 15);   // chips row margin
const EDGE = Math.ceil(LG?.resizeEdgeSize ?? 5);        // readout row margin
const CHIPS_MIN_H = 28;      // content height of the chips row, at least
const PREVIEW_H = 16;        // content height of the readout row, fixed
const STYLE_ID = "magik-duration-style";

// Mirror of RECIPES in magik_duration.py. tests/test_parity.py fails if the
// two tables (or the README's) ever drift apart.
const RECIPES = {
  "MiniMax H3": { fps: 24, step: 17, plus: 5, min_frames: 5 },
  "Wan 2.x": { fps: 16, step: 4, plus: 1, min_frames: 1 },
  "Hunyuan": { fps: 24, step: 4, plus: 1, min_frames: 1 },
  "LTX": { fps: 24, step: 8, plus: 1, min_frames: 1 },
  "Plain frames": { fps: 24, step: 1, plus: 0, min_frames: 1 },
};

// The dropdown's own list (set by Python) is the source for the panel's names.
function recipeNames(node) {
  const values = node.widgets?.find((w) => w.name === "recipe")?.options?.values;
  const list = typeof values === "function" ? values() : values;
  return Array.isArray(list) ? list : [...Object.keys(RECIPES), "Custom formula", "Manual"];
}

const DEFAULT_CHIPS = [3, 5, 10];

// ── frame maths (mirror of duration_helpers.py; extracted by the tests) ──────
// Same clamps, same round-half-to-EVEN, same non-negative modulo.

const MAX_FPS = 1000;
const MAX_STEP = 100000;
const MAX_FRAMES = 1000000;
const MAX_SECONDS = 100000;

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
  if (raw < plus) raw = plus;   // the pattern starts at `plus` (n >= 0)
  const remainder = mod(raw - plus, step);
  return remainder ? raw + (step - remainder) : raw;
}

function framesFromSeconds(seconds, fps, step, plus, minFrames) {
  seconds = num(seconds, 5, -MAX_SECONDS, MAX_SECONDS);
  fps = num(fps, 24, 0, MAX_FPS);
  step = Math.trunc(num(step, 17, 0, MAX_STEP));
  plus = Math.trunc(num(plus, 5, 0, MAX_STEP));
  minFrames = Math.trunc(num(minFrames, 5, 0, MAX_FRAMES));
  let raw = pyRound(seconds * fps);
  if (raw < minFrames) raw = minFrames;
  raw = snapFrames(raw, step, plus);
  return Math.max(0, Math.min(MAX_FRAMES, raw));
}
// ── end frame maths ──────────────────────────────────────────────────────────

function fmt(value, places = 2) {
  return String(Math.round(value * 10 ** places) / 10 ** places);
}

/** The frames Python would send from the recipe numbers on the node. */
function previewFrames(node) {
  const w = widgetValues(node);
  return framesFromSeconds(w.seconds, w.fps, w.step, w.plus, w.min_frames);
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
    /* --magik-acc is an optional suite-wide accent; this is its one fallback */
    .magik-duration-chips, .magik-duration-preview, .magik-duration-slider, .magik-dur-panel { --magik-dur-acc: var(--magik-acc, #f66744); }
    .magik-duration-chips {
      position: relative; display: flex; align-items: stretch; gap: 4px; padding: 2px 22px 2px 2px;
      flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; overflow: hidden;
      height: 100%; box-sizing: border-box;
    }
    .magik-duration-chips .magik-chip {
      min-width: 0; min-height: 0; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--magik-dur-acc) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--magik-dur-acc) 42%, transparent);
      outline: 1px solid color-mix(in srgb, #add8e6 70%, transparent);
      border-radius: 4px; color: rgba(255,255,255,0.72);
      font-size: 12px; padding: 2px 4px; cursor: pointer; text-align: center; line-height: 1.1;
      white-space: nowrap; overflow: hidden;
    }
    .magik-duration-chips .magik-chip:hover { background: color-mix(in srgb, var(--magik-dur-acc) 32%, transparent); border-color: var(--magik-dur-acc); color: #ddd; }
    .magik-duration-chips .magik-chip.magik-active,
    .magik-duration-chips .magik-chip.magik-active:hover {
      background: var(--magik-dur-acc); border-color: var(--magik-dur-acc); color: #fff;
    }
    .magik-duration-chips .magik-gear {
      position: absolute; right: 3px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; padding: 0; margin: 0; line-height: 0;
      background: none; border: none; cursor: pointer; color: #bbb;
    }
    .magik-duration-chips .magik-gear:hover { color: var(--magik-dur-acc); }
    .magik-duration-chips .magik-gear svg { display: block; width: 14px; height: 14px; fill: currentColor; }
    .magik-duration-preview {
      height: 100%; box-sizing: border-box; display: block;
      padding: 0 12px; font-size: 11px; line-height: 16px; color: var(--magik-dur-acc);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .magik-duration-preview span + span { margin-left: 5px; }
    .magik-duration-preview .magik-dim { color: rgba(255,255,255,0.42); }
    .magik-dur-panel { position: fixed; z-index: 10010; width: 330px; max-width: 94vw; max-height: 82vh; overflow: auto; background: #2b2b2b; border: 1px solid #444; border-radius: 8px; box-shadow: 0 10px 34px rgba(0,0,0,0.55); color: #ddd; font: 12px 'Segoe UI', sans-serif; }
    .magik-dur-hd { display: flex; align-items: center; gap: 7px; padding: 8px 11px; background: #333; border-bottom: 1px solid #444; cursor: move; user-select: none; }
    .magik-dur-hd b { font-weight: 500; font-size: 12px; }
    .magik-dur-hd .magik-dur-x { margin-left: auto; background: none; border: none; color: #999; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; }
    .magik-dur-hd .magik-dur-x:hover { color: #fff; }
    .magik-dur-bd { padding: 11px; display: flex; flex-direction: column; gap: 11px; }
    .magik-dur-sec { display: flex; flex-direction: column; gap: 6px; }
    .magik-dur-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--magik-dur-acc); }
    .magik-dur-pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .magik-dur-pills.row .magik-dur-pill { flex: 1; }
    .magik-dur-pill { flex: 1 1 44%; text-align: center; box-sizing: border-box; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; color: rgba(255,255,255,0.72); font-size: 11px; padding: 5px 4px; cursor: pointer; }
    .magik-dur-pill:hover { border-color: var(--magik-dur-acc); color: #ddd; }
    .magik-dur-pill.on, .magik-dur-pill.on:hover { background: var(--magik-dur-acc); border-color: var(--magik-dur-acc); color: #fff; }
    .magik-dur-panel input[type=text], .magik-dur-panel textarea { box-sizing: border-box; width: 100%; background: #1d1d1d; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; font: 12px monospace; padding: 6px 8px; outline: none; }
    .magik-dur-panel input[type=text]:focus, .magik-dur-panel textarea:focus { border-color: var(--magik-dur-acc); }
    .magik-dur-panel input.bad { border-color: #e8694a; }
    .magik-dur-panel textarea { resize: vertical; min-height: 52px; }
    .magik-dur-panel input[type=color] { width: 100%; height: 26px; padding: 2px; background: #1d1d1d; border: 1px solid #444; border-radius: 4px; cursor: pointer; }
    .magik-dur-grid3 { display: flex; gap: 6px; }
    .magik-dur-fld { flex: 1; min-width: 0; background: #1d1d1d; border: 1px solid #444; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; padding: 4px 7px; gap: 4px; }
    .magik-dur-fld:focus-within { border-color: var(--magik-dur-acc); }
    .magik-dur-fld span { font-size: 10px; color: var(--magik-dur-acc); letter-spacing: .3px; }
    .magik-dur-fld input { width: 52px; background: none; border: none; outline: none; text-align: right; color: var(--magik-dur-acc); font: 12px 'Segoe UI', sans-serif; }
    .magik-dur-prev { background: rgba(0,0,0,0.25); border-radius: 4px; padding: 7px 9px; font: 11px/1.6 monospace; color: rgba(255,255,255,0.8); max-height: 132px; overflow: auto; }
    .magik-dur-prev .n { color: var(--magik-dur-acc); }
    .magik-dur-note { font-size: 11px; color: rgba(255,255,255,0.45); line-height: 1.5; }
    .magik-duration-slider { height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 12px; }
    .magik-duration-slider input[type=range] { flex: 1; accent-color: var(--magik-dur-acc); }
    .magik-duration-slider b { font: 11px monospace; color: var(--magik-dur-acc); min-width: 48px; text-align: right; }
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
    ? normalizeChips(list)
    : [...DEFAULT_CHIPS];
}

function addChipsWidget(node) {
  const element = document.createElement("div");
  element.className = "magik-duration-chips";
  const widget = node.addDOMWidget("magik_duration_chips", "magik_duration_chips", element, {
    getValue: () => chipsFor(node).map((v) => ({ type: "duration", value: v })),
    setValue: () => {},
    hideOnZoom: false,
    margin: CORNER,   // keeps the bottom corners (and the sides) grabbable
  });
  widget.serializeValue = () => undefined;   // DOM only, never saved in the widget
  widget.serialize = false;                  // ...and never written to the workflow's widgets_values
  // The frontend owns this row's height (and writes widget.computedHeight
  // itself): a 28px minimum and no maximum, so the row absorbs all the free
  // space the node has left over. Nothing here measures or guesses; the labels
  // are just re-fitted whenever the row's real size changes.
  element.style.setProperty("--comfy-widget-min-height", `${CHIPS_MIN_H + 2 * CORNER}px`);
  if (typeof ResizeObserver !== "undefined") {
    node._magikChipsObserver?.disconnect();
    node._magikChipsObserver = new ResizeObserver(() => fitChips(element));
    node._magikChipsObserver.observe(element);
  }

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
        syncRecipeFromNumbers(node);
      });
      element.appendChild(btn);
    }
    const gear = document.createElement("button");
    gear.className = "magik-gear";
    gear.title = "Duration settings";
    gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';
    gear.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      openSettingsPanel(node);
    });
    element.appendChild(gear);
    fitChips(element);
  };
  element.addEventListener("dblclick", (e) => {
    e.preventDefault(); e.stopPropagation();
    openSettingsPanel(node);
  });
  widget.renderChips = render;
  render();
  return widget;
}
function addSliderWidget(node) {
  const element = document.createElement("div");
  element.className = "magik-duration-slider";
  const range = document.createElement("input");
  range.type = "range";
  const label = document.createElement("b");
  element.append(range, label);
  const widget = node.addDOMWidget("magik_duration_slider", "magik_duration_slider", element, {
    getValue: () => undefined,
    setValue: () => {},
    hideOnZoom: false,
    margin: CORNER,   // keeps the bottom corners (and the sides) grabbable
  });
  widget.serializeValue = () => undefined;
  widget.serialize = false;
  element.style.setProperty("--comfy-widget-min-height", `${CHIPS_MIN_H + 2 * CORNER}px`);
  const render = () => {
    const chips = chipsFor(node);
    const hi = Math.max(10, ...chips);
    range.min = 0;
    range.max = hi;
    range.step = 0.1;
    const s = parseFloat(widgetValues(node).seconds);
    range.value = Number.isFinite(s) ? Math.min(hi, Math.max(0, s)) : 0;
    label.textContent = fmt(parseFloat(range.value)) + " s";
  };
  range.addEventListener("input", () => {
    setWidgetValue(node, "seconds", parseFloat(range.value));
    label.textContent = fmt(parseFloat(range.value)) + " s";
  });
  widget.renderSlider = render;
  render();
  return widget;
}


// ── settings panel (gear) ──
// The floating "Duration settings" panel: how you pick, the allowed durations,
// the recipe (Convert to frames) with its numbers, a live "What it will send"
// list, and the button colour. Everything it edits lives on the real widgets or
// node.properties, so saved workflows and API runs see exactly what it shows.

let _panel = null;
let _panelNode = null;
let _chipsInput = null;

const PICK_BUTTONS = "buttons";
const PICK_SLIDER = "slider";
const PICK_NUMBER = "number";
const LS_DEFAULT_ACCENT = "magik-duration:default-accent";  // default for new nodes
const LS_SUITE_ACCENT = "magik:accent";                     // suite-wide --magik-acc

function pickMode(node) {
  const p = node.properties?.magik_duration_pick;
  return p === PICK_SLIDER || p === PICK_NUMBER ? p : PICK_BUTTONS;
}

function accentOf(node) {
  return node.properties?.magik_duration_accent || null;
}

function defaultAccent() {
  try { return localStorage.getItem(LS_DEFAULT_ACCENT); } catch { return null; }
}

function applyAccent(node) {
  const acc = accentOf(node) || defaultAccent();
  for (const name of ["magik_duration_chips", "magik_duration_slider", "magik_duration_preview"]) {
    const el = node.widgets?.find((w) => w.name === name)?.element;
    if (!el) continue;
    if (acc) el.style.setProperty("--magik-dur-acc", acc);
    else el.style.removeProperty("--magik-dur-acc");
  }
  if (_panelNode === node && _panel) {
    if (acc) _panel.style.setProperty("--magik-dur-acc", acc);
    else _panel.style.removeProperty("--magik-dur-acc");
  }
}

function normalizeChips(list) {
  const vals = list
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v * 100) / 100);
  return [...new Set(vals)].sort((a, b) => a - b).slice(0, 12);
}

function parseChips(text) {
  return String(text || "").split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((v) => Number.isFinite(v));
}

// frames the recipe numbers would send for a given length; null in formula mode
function previewFor(node, seconds) {
  const w = widgetValues(node);
  if (w.recipe === "Custom formula" && String(w.formula || "").trim() !== "") return null;
  const frames = framesFromSeconds(seconds, w.fps, w.step, w.plus, w.min_frames);
  const fps = num(w.fps, 24, 0, 1000);
  return { frames, actual: fps > 0 ? frames / fps : 0 };
}

function outsideClosePanel(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".magik-gear")) return;
  closeSettingsPanel();
}

function escClosePanel(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

function closeSettingsPanel() {
  // commit a half-typed durations list on close (the outside pointerdown runs
  // before the input's blur/change would)
  if (_panel && _panelNode && _chipsInput) {
    const list = normalizeChips(parseChips(_chipsInput.value));
    if (list.length) {
      _panelNode.properties = _panelNode.properties || {};
      _panelNode.properties.magik_duration_chips = list;
      repaintExtras(_panelNode);
    }
  }
  document.removeEventListener("pointerdown", outsideClosePanel, true);
  document.removeEventListener("keydown", escClosePanel, true);
  try { _panel?.remove(); } catch {}
  _panel = null;
  _panelNode = null;
  _chipsInput = null;
}

function nodeScreenRect(node) {
  if (node.id != null) {
    const el = document.querySelector(`[data-node-id="${node.id}"]`);
    if (el) return el.getBoundingClientRect();
  }
  const c = app.canvas;
  if (c?.ds && c?.canvas && node.pos && node.size) {
    const cr = c.canvas.getBoundingClientRect();
    const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
    const sc = c.ds.scale || 1;
    const off = c.ds.offset || [0, 0];
    const left = cr.left + (node.pos[0] + off[0]) * sc;
    const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
    return { left, top, right: left + node.size[0] * sc, bottom: top + (node.size[1] + titleH) * sc, width: node.size[0] * sc, height: (node.size[1] + titleH) * sc };
  }
  return null;
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}


function panelSection(title) {
  const s = document.createElement("div");
  s.className = "magik-dur-sec";
  const l = document.createElement("div");
  l.className = "magik-dur-lbl";
  l.textContent = title;
  s.appendChild(l);
  return s;
}

function panelPill(label, on, tip, onClick) {
  const p = document.createElement("div");
  p.className = "magik-dur-pill" + (on ? " on" : "");
  p.textContent = label;
  if (tip) p.title = tip;
  p.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return p;
}

function panelField(label, value, onChange, tip) {
  const f = document.createElement("div");
  f.className = "magik-dur-fld";
  const s = document.createElement("span");
  s.textContent = label;
  const i = document.createElement("input");
  i.type = "text";
  i.value = String(value);
  if (tip) f.title = tip;
  i.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); i.blur(); }
  });
  i.addEventListener("change", () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  f.append(s, i);
  return f;
}

function fillPanel(bd, node, rebuild) {
  const changed = () => { hideAdvanced(node); repaintExtras(node); rebuild(); };
  const w = widgetValues(node);

  // ── How you pick ──
  const pickSec = panelSection("How you pick");
  const pickRow = document.createElement("div");
  pickRow.className = "magik-dur-pills row";
  const pick = pickMode(node);
  for (const [mode, label, tip] of [
    [PICK_BUTTONS, "Buttons", "Show one button per allowed length. Best for a few choices."],
    [PICK_SLIDER, "Slider", "Drag between the shortest and longest allowed length."],
    [PICK_NUMBER, "Type it", "Type any length in seconds."],
  ]) {
    pickRow.appendChild(panelPill(label, pick === mode, tip, () => {
      node.properties = node.properties || {};
      node.properties.magik_duration_pick = mode;
      const chips = chipsFor(node);
      const s = parseFloat(w.seconds);
      if (Number.isFinite(s)) {
        setWidgetValue(node, "seconds", Math.min(Math.max(...chips), Math.max(mode === PICK_BUTTONS ? Math.min(...chips) : 0, s)));
      }
      changed();
    }));
  }
  pickSec.appendChild(pickRow);
  bd.appendChild(pickSec);

  // ── Allowed durations ──
  const allowed = panelSection("Allowed durations");
  const input = document.createElement("input");
  input.type = "text";
  input.value = chipsFor(node).join(", ");
  input.title = "The lengths to offer, in seconds, separated by commas";
  input.spellcheck = false;
  _chipsInput = input;
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
  input.addEventListener("change", () => {
    const list = normalizeChips(parseChips(input.value));
    if (!list.length) { input.classList.add("bad"); return; }
    input.classList.remove("bad");
    node.properties = node.properties || {};
    node.properties.magik_duration_chips = list;
    const s = parseFloat(w.seconds);
    if (Number.isFinite(s)) setWidgetValue(node, "seconds", Math.min(list[list.length - 1], Math.max(list[0], s)));
    changed();
  });
  allowed.appendChild(input);
  const note = document.createElement("div");
  note.className = "magik-dur-note";
  note.textContent = "Up to 12 lengths. They are sorted for you.";
  allowed.appendChild(note);
  bd.appendChild(allowed);

  // ── Convert to frames ──
  const conv = panelSection("Convert to frames");
  const recipeRow = document.createElement("div");
  recipeRow.className = "magik-dur-pills";
  const current = w.recipe;
  for (const name of recipeNames(node)) {
    recipeRow.appendChild(panelPill(name, current === name, undefined, () => {
      setWidgetValue(node, "recipe", name);
      applyRecipeNumbers(node, name);
      changed();
    }));
  }
  conv.appendChild(recipeRow);
  if (current === "Custom formula") {
    const ta = document.createElement("textarea");
    ta.value = String(w.formula || "");
    ta.placeholder = "max(5, round(a * 24))";
    ta.title = "a is the length in seconds. fps and seconds are available too.";
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    ta.addEventListener("change", () => { setWidgetValue(node, "formula", ta.value); changed(); });
    conv.appendChild(ta);
    const fnote = document.createElement("div");
    fnote.className = "magik-dur-note";
    fnote.textContent = "a is the length in seconds. You can also use fps. If the formula does not work the node falls back to the numbers on the node.";
    conv.appendChild(fnote);
  } else {
    const row = document.createElement("div");
    row.className = "magik-dur-grid3";
    row.append(
      panelField("FPS", fmt(w.fps), (v) => { setWidgetValue(node, "fps", v); changed(); }, "Frames per second the model runs at"),
      panelField("STEP", w.step, (v) => { setWidgetValue(node, "step", Math.trunc(v)); changed(); }, "Frame count must land on a multiple of this. 1 means no rounding."),
      panelField("PLUS", w.plus, (v) => { setWidgetValue(node, "plus", Math.trunc(v)); changed(); }, "Added on top of the multiple: step 17, plus 5 means 22, 39, 56 ..."),
    );
    conv.appendChild(row);
    const row2 = document.createElement("div");
    row2.className = "magik-dur-grid3";
    row2.appendChild(panelField("LEAST", w.min_frames, (v) => { setWidgetValue(node, "min_frames", Math.trunc(v)); changed(); }, "Never send fewer frames than this"));
    conv.appendChild(row2);
  }
  bd.appendChild(conv);

  // ── What it will send ──
  const prevSec = panelSection("What it will send");
  const box = document.createElement("div");
  box.className = "magik-dur-prev";
  const custom = current === "Custom formula" && String(w.formula || "").trim() !== "";
  for (const v of chipsFor(node)) {
    const line = document.createElement("div");
    const secs = document.createElement("span");
    secs.textContent = String(fmt(v)).padStart(6, " ") + " s  →  ";
    const n = document.createElement("span");
    n.className = "n";
    line.append(secs, n);
    if (!custom) {
      const c = previewFor(node, v);
      n.textContent = c.frames + " frames";
      if (Math.abs(c.actual - v) > 0.005) {
        const rn = document.createElement("span");
        rn.textContent = `  (really ${fmt(c.actual)} s)`;
        rn.style.color = "rgba(255,255,255,0.4)";
        line.appendChild(rn);
      }
    } else {
      n.textContent = "frames set by formula";
    }
    box.appendChild(line);
  }
  prevSec.appendChild(box);
  bd.appendChild(prevSec);

  // ── Button colour ──
  const colSec = panelSection("Button colour");
  const color = document.createElement("input");
  color.type = "color";
  color.value = accentOf(node) || defaultAccent() || "#f66744";
  color.title = "Accent colour for this node's buttons and labels";
  color.addEventListener("change", () => {
    node.properties = node.properties || {};
    node.properties.magik_duration_accent = color.value;
    applyAccent(node);
    repaintExtras(node);
  });
  colSec.appendChild(color);
  const cnote = document.createElement("div");
  cnote.className = "magik-dur-note";
  cnote.textContent = "This node only. Save it as a default below.";
  colSec.appendChild(cnote);
  const defRow = document.createElement("div");
  defRow.className = "magik-dur-pills row";
  defRow.append(
    panelPill("New Duration nodes", false, "Save this colour as the default for new nodes", () => {
      try { localStorage.setItem(LS_DEFAULT_ACCENT, color.value); } catch {}
      applyAccent(node);
    }),
    panelPill("Every Magik node", false, "Set the suite-wide --magik-acc colour", () => {
      try { localStorage.setItem(LS_SUITE_ACCENT, color.value); } catch {}
      document.documentElement.style.setProperty("--magik-acc", color.value);
      applyAccent(node);
    }),
  );
  colSec.appendChild(defRow);
  bd.appendChild(colSec);
}

function openSettingsPanel(node) {
  if (_panelNode === node && _panel?.isConnected) {
    closeSettingsPanel();
    return;
  }
  closeSettingsPanel();

  const panel = document.createElement("div");
  panel.className = "magik-dur-panel";
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  const head = document.createElement("div");
  head.className = "magik-dur-hd";
  const title = document.createElement("b");
  title.textContent = "Duration settings";
  const x = document.createElement("button");
  x.className = "magik-dur-x";
  x.textContent = "✕";
  x.title = "Close";
  x.addEventListener("click", (e) => { e.stopPropagation(); closeSettingsPanel(); });
  head.append(title, x);
  // drag by the header
  head.addEventListener("pointerdown", (e) => {
    if (e.target === x) return;
    const sx = e.clientX, sy = e.clientY;
    const r = panel.getBoundingClientRect();
    try { head.setPointerCapture(e.pointerId); } catch {}
    const move = (mv) => {
      if (!(mv.buttons & 1)) { end(); return; }
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, r.left + mv.clientX - sx))}px`;
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, r.top + mv.clientY - sy))}px`;
    };
    const end = () => {
      head.removeEventListener("pointermove", move);
      try { head.releasePointerCapture(e.pointerId); } catch {}
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", end, { once: true });
    head.addEventListener("pointercancel", end, { once: true });
    head.addEventListener("lostpointercapture", end, { once: true });
  });

  const body = document.createElement("div");
  body.className = "magik-dur-bd";
  panel.append(head, body);

  const rebuild = () => {
    const scroll = body.scrollTop;
    body.textContent = "";
    fillPanel(body, node, rebuild);
    body.scrollTop = scroll;
  };
  rebuild();

  document.body.appendChild(panel);
  applyAccent(node);
  placeBeside(panel, nodeScreenRect(node));
  _panel = panel;
  _panelNode = node;
  document.addEventListener("pointerdown", outsideClosePanel, true);
  document.addEventListener("keydown", escClosePanel, true);
}

function addPreviewWidget(node) {
  const element = document.createElement("div");
  element.className = "magik-duration-preview";
  const widget = node.addDOMWidget("magik_duration_preview", "magik_duration_preview", element, {
    getValue: () => undefined,
    setValue: () => {},
    hideOnZoom: false,
    margin: EDGE,   // keeps the side edges grabbable along this row
  });
  widget.serializeValue = () => undefined;
  widget.serialize = false;                  // never written to the workflow's widgets_values
  // fixed row (content height + its margins): min = max, so the frontend gives
  // this row exactly its height and hands the rest of the node to the chips row
  element.style.setProperty("--comfy-widget-min-height", `${PREVIEW_H + 2 * EDGE}px`);
  element.style.setProperty("--comfy-widget-max-height", `${PREVIEW_H + 2 * EDGE}px`);

  const render = () => {
    const w = widgetValues(node);
    const picked = parseFloat(w.seconds);
    const custom =
      w.recipe === "Custom formula" && String(w.formula || "").trim() !== "";
    element.textContent = "";
    const main = document.createElement("span");
    if (custom) {
      // a formula is only ever evaluated by Python at run time: no frame count
      main.textContent = `${fmt(picked)} s → frames set by formula`;
      element.appendChild(main);
      return;
    }
    const frames = previewFrames(node);
    const fps = num(w.fps, 24, 0, 1000);
    const actual = fps > 0 ? frames / fps : 0;
    main.textContent = `${fmt(picked)} s → ${frames} frames`;
    element.appendChild(main);
    if (Math.abs(actual - picked) > 0.005) {
      const dim = document.createElement("span");
      dim.className = "magik-dim";
      dim.textContent = `(really ${fmt(actual)} s)`;
      element.appendChild(dim);
    }
  };
  widget.renderPreview = render;
  render();
  return widget;
}

// ── recipe picker ────────────────────────────────────────────────────────────

function syncRecipeFromNumbers(node) {
  // Selecting a recipe copies its numbers; editing a number by hand flips the
  // recipe to Manual so the recipe value never lies about what will run.
  if (node._magikApplying) return;
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
  // The Python widgets stay the source of truth for saved workflows and the
  // API, but on the canvas the DOM face replaces them: the recipe is always
  // hidden, seconds shows only in "Type it" mode, the chips/slider rows swap
  // with the pick mode, and the raw numbers only show for Manual / Custom
  // formula, where they must be editable.
  const recipe = widgetValues(node).recipe;
  const advanced = recipe === "Manual" || recipe === "Custom formula";
  const pick = pickMode(node);
  const visible = {
    recipe: false,
    seconds: pick === PICK_NUMBER,
    fps: advanced,
    step: advanced,
    plus: advanced,
    min_frames: advanced,
    formula: advanced,
    magik_duration_chips: pick === PICK_BUTTONS,
    magik_duration_slider: pick === PICK_SLIDER,
  };
  for (const name of Object.keys(visible)) {
    // `hidden` is the frontend's own switch: it drops the row from the layout
    // and hides a DOM widget's element. The frontend owns type, computedHeight
    // and display, so none of them is touched here.
    const widget = node.widgets?.find((w) => w.name === name);
    if (widget) widget.hidden = !visible[name];
  }
  applyAccent(node);
  node.setDirtyCanvas?.(true, true);
  // recalc layout to the new visible widget count; width and height only
  // grow to the minimum, never clamp down a node the user resized, so the
  // saved size survives reloads and tab switches
  const min = node.computeSize?.();
  if (min) {
    const w = Math.max(node.size?.[0] ?? min[0], min[0]);
    const h = Math.max(node.size?.[1] ?? min[1], min[1]);
    node.setSize?.([w, h]);
  }
}

// Lay the chips out as a grid of near-square tiles that fills the whole row,
// then size each label to the largest font that fits inside its own button:
// vertically (line box must fit the button height) and horizontally (text
// width must fit the button width), so labels fill the buttons without
// ever spilling out of them.
function fitChips(el) {
  const chips = [...el.querySelectorAll(".magik-chip")];
  const n = chips.length;
  const box = getComputedStyle(el);
  const w = el.clientWidth - (parseFloat(box.paddingLeft) || 0) - (parseFloat(box.paddingRight) || 0);
  const h = el.clientHeight - (parseFloat(box.paddingTop) || 0) - (parseFloat(box.paddingBottom) || 0);
  if (n && w > 20 && h > 20) {
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / h))));
    const rows = Math.ceil(n / cols);
    el.style.display = "grid";
    el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  }
  for (const btn of chips) {
    btn.style.fontSize = "";
    const cs = getComputedStyle(btn);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // computed line-height is in px (e.g. "13.2px"), not the unitless 1.1 from
    // the CSS, so convert it back to a ratio; "normal" parses to NaN -> 1.1
    const lhPx = parseFloat(cs.lineHeight);
    const fsPx = parseFloat(cs.fontSize);
    const line = Number.isFinite(lhPx) && fsPx > 0 ? lhPx / fsPx : 1.1;
    let fs = Math.max(8, (btn.clientHeight - padY) / line);
    btn.style.fontSize = fs + "px";
    for (let i = 0; i < 4 && btn.scrollWidth > btn.clientWidth && fs > 8; i++) {
      fs = Math.max(8, Math.floor((fs * btn.clientWidth) / btn.scrollWidth));
      btn.style.fontSize = fs + "px";
    }
  }
}

const WIRED_WIDGETS = ["recipe", "seconds", "fps", "step", "plus", "min_frames", "formula"];

// Copy a recipe's numbers onto the node's widgets. Used both by the wrapped
// recipe-widget callback (dropdown changes) and directly by the settings-panel
// buttons, so picking a recipe works even if the callback was never wrapped -
// e.g. a frontend that adds the input widgets only after onNodeCreated ran.
function applyRecipeNumbers(node, name) {
  const r = RECIPES[name];
  if (!r) return;
  node._magikApplying = true;
  setWidgetValue(node, "fps", r.fps);
  setWidgetValue(node, "step", r.step);
  setWidgetValue(node, "plus", r.plus);
  setWidgetValue(node, "min_frames", r.min_frames);
  node._magikApplying = false;
}

function wireWidgets(node) {
  const recipeWidget = node.widgets?.find((w) => w.name === "recipe");
  if (recipeWidget && !recipeWidget._magikWired) {
    recipeWidget._magikWired = true;
    const orig = recipeWidget.callback;
    recipeWidget.callback = (value) => {
      orig?.(value);
      applyRecipeNumbers(node, value);
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
        syncRecipeFromNumbers(node);
      }
      hideAdvanced(node);
      repaintExtras(node);
    };
  }
  // Idempotent: safe to call again whenever widgets may have appeared late.
  node._magikWiredDone = WIRED_WIDGETS.every((n) => node.widgets?.find((w) => w.name === n)?._magikWired);
}

function repaintExtras(node) {
  const chips = node.widgets?.find((w) => w.name === "magik_duration_chips");
  const slider = node.widgets?.find((w) => w.name === "magik_duration_slider");
  const preview = node.widgets?.find((w) => w.name === "magik_duration_preview");
  chips?.renderChips?.();
  slider?.renderSlider?.();
  preview?.renderPreview?.();
}

// keep the face fresh whenever the user types without every widget firing a
// callback: one cheap draw hook.
function patchOnDraw(nodeType) {
  const _draw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function () {
    if (this._magikExtras) {
      // widgets can appear after onNodeCreated on some frontends; wireWidgets
      // is idempotent, so retry until every known widget is wrapped
      if (!this._magikWiredDone) wireWidgets(this);
      // values only: size changes are handled by the chips row's ResizeObserver,
      // so resizing the node never rebuilds the buttons. The cache is per node:
      // a shared one made two nodes invalidate each other every frame.
      const key = JSON.stringify(widgetValues(this));
      if (key !== this._magikLastKey) { this._magikLastKey = key; repaintExtras(this); }
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
    try {
      const suite = localStorage.getItem(LS_SUITE_ACCENT);
      if (suite) document.documentElement.style.setProperty("--magik-acc", suite);
    } catch {}
    patchOnDraw(nodeType);

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      wireWidgets(this);
      this._magikExtras = true;
      addPreviewWidget(this);
      addChipsWidget(this);
      addSliderWidget(this);
      hideAdvanced(this);
      queueMicrotask(() => { wireWidgets(this); repaintExtras(this); hideAdvanced(this); });
      return r;
    };

    const _added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function () {
      const r = _added?.apply(this, arguments);
      wireWidgets(this);   // classic canvas adds the input widgets after onNodeCreated
      return r;
    };

    const _configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configured?.apply(this, arguments);
      wireWidgets(this);
      hideAdvanced(this);
      queueMicrotask(() => { wireWidgets(this); repaintExtras(this); hideAdvanced(this); });
      return r;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (_panelNode === this) closeSettingsPanel();
      this._magikChipsObserver?.disconnect();
      return _removed?.apply(this, arguments);
    };
  },
});

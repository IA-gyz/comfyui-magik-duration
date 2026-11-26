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
    .magik-duration-chips, .magik-duration-preview, .magik-dur-panel { --magik-dur-acc: var(--magik-acc, #f66744); }
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
    .magik-dur-panel { position: fixed; z-index: 10010; width: 300px; max-width: 94vw; background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,0.6); color: #d8d8d8; font: 12px 'Segoe UI', sans-serif; }
    .magik-dur-head { display: flex; align-items: center; padding: 8px 10px; background: #232323; border-bottom: 1px solid #333; }
    .magik-dur-head b { color: var(--magik-dur-acc); font-weight: 600; }
    .magik-dur-x { margin-left: auto; cursor: pointer; color: #8a8a8a; padding: 0 4px; }
    .magik-dur-x:hover { color: #fff; }
    .magik-dur-body { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .magik-dur-lab { font-size: 11px; color: #8a8a8a; margin-bottom: 4px; }
    .magik-dur-recipes { display: flex; flex-wrap: wrap; gap: 4px; }
    .magik-dur-recipes button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; color: rgba(255,255,255,0.72); font-size: 12px; padding: 4px 8px; cursor: pointer; }
    .magik-dur-recipes button:hover { border-color: var(--magik-dur-acc); color: #ddd; }
    .magik-dur-recipes button.on { background: var(--magik-dur-acc); border-color: var(--magik-dur-acc); color: #fff; }
    .magik-dur-rule { height: 1px; background: #333; }
    .magik-dur-chips-input { width: 100%; box-sizing: border-box; background: #1d1d1d; border: 1px solid #444; border-radius: 4px; padding: 6px 8px; color: #e0e0e0; font: 12px monospace; outline: none; }
    .magik-dur-chips-input:focus { border-color: var(--magik-dur-acc); }
    .magik-dur-chips-input.bad { border-color: #e8694a; }
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

// ── settings panel (gear) ──
// One panel, two separate sections: a recipe picker and a quick-durations
// field. Replaces the old combined window.prompt.

let _panel = null;
let _panelNode = null;

function parseChips(text) {
  return String(text || "").split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
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
  if (_panel && _panelNode && _panel._chipsInput) {
    const list = parseChips(_panel._chipsInput.value);
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
  head.className = "magik-dur-head";
  const title = document.createElement("b");
  title.textContent = "Magik Duration";
  const x = document.createElement("span");
  x.className = "magik-dur-x";
  x.textContent = "✕";
  x.title = "Close";
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsPanel();
  });
  head.append(title, x);

  const body = document.createElement("div");
  body.className = "magik-dur-body";

  const recipeSec = document.createElement("div");
  const recipeLab = document.createElement("div");
  recipeLab.className = "magik-dur-lab";
  recipeLab.textContent = "Recipe (copies fps/step/plus/min-frames onto the node)";
  const recipesEl = document.createElement("div");
  recipesEl.className = "magik-dur-recipes";
  recipeSec.append(recipeLab, recipesEl);

  const rule = document.createElement("div");
  rule.className = "magik-dur-rule";

  const chipsSec = document.createElement("div");
  const chipsLab = document.createElement("div");
  chipsLab.className = "magik-dur-lab";
  chipsLab.textContent = "Quick durations (seconds, comma separated)";
  const input = document.createElement("input");
  input.className = "magik-dur-chips-input";
  input.type = "text";
  input.value = chipsFor(node).join(", ");
  input.spellcheck = false;
  chipsSec.append(chipsLab, input);

  body.append(recipeSec, rule, chipsSec);
  panel.append(head, body);
  panel._chipsInput = input;

  const paintRecipes = () => {
    recipesEl.textContent = "";
    for (const name of recipeNames(node)) {
      const b = document.createElement("button");
      b.className = widgetValues(node).recipe === name ? "on" : "";
      b.textContent = name;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        setWidgetValue(node, "recipe", name);
        paintRecipes();
      });
      recipesEl.appendChild(b);
    }
  };
  paintRecipes();

  const commit = () => {
    const list = parseChips(input.value);
    if (!list.length) {
      input.classList.add("bad");
      return false;
    }
    input.classList.remove("bad");
    node.properties = node.properties || {};
    node.properties.magik_duration_chips = list;
    repaintExtras(node);
    return true;
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      // stay open on invalid input so the red border is actually seen
      if (commit()) closeSettingsPanel();
    }
  });
  input.addEventListener("blur", commit);

  document.body.appendChild(panel);
  placeBeside(panel, nodeScreenRect(node));
  _panel = panel;
  _panelNode = node;
  document.addEventListener("pointerdown", outsideClosePanel, true);
  document.addEventListener("keydown", escClosePanel, true);
  input.focus?.();
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
  // API, but on the canvas the DOM face (chips + gear + readout) replaces
  // them: recipe and seconds are always hidden, and the raw numbers only show
  // for Manual / Custom formula, where they must be editable.
  const recipe = widgetValues(node).recipe;
  const advanced = recipe === "Manual" || recipe === "Custom formula";
  const visible = {
    recipe: false,
    seconds: false,
    fps: advanced,
    step: advanced,
    plus: advanced,
    min_frames: advanced,
    formula: advanced,
  };
  for (const name of Object.keys(visible)) {
    // `hidden` is the frontend's own switch: it drops the row from the layout
    // and hides a DOM widget's element. The frontend owns type, computedHeight
    // and display, so none of them is touched here.
    const widget = node.widgets?.find((w) => w.name === name);
    if (widget) widget.hidden = !visible[name];
  }
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

function wireWidgets(node) {
  const recipeWidget = node.widgets?.find((w) => w.name === "recipe");
  if (recipeWidget && !recipeWidget._magikWired) {
    recipeWidget._magikWired = true;
    const orig = recipeWidget.callback;
    recipeWidget.callback = (value) => {
      orig?.(value);
      const r = RECIPES[value];
      if (r) {
        node._magikApplying = true;
        setWidgetValue(node, "fps", r.fps);
        setWidgetValue(node, "step", r.step);
        setWidgetValue(node, "plus", r.plus);
        setWidgetValue(node, "min_frames", r.min_frames);
        node._magikApplying = false;
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
        syncRecipeFromNumbers(node);
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
  nodeType.prototype.onDrawForeground = function () {
    if (this._magikExtras) {
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
    patchOnDraw(nodeType);

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      wireWidgets(this);
      this._magikExtras = true;
      addPreviewWidget(this);
      addChipsWidget(this);
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

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (_panelNode === this) closeSettingsPanel();
      this._magikChipsObserver?.disconnect();
      return _removed?.apply(this, arguments);
    };
  },
});

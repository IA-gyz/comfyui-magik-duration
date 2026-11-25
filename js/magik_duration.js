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
      position: relative; display: flex; align-items: stretch; gap: 4px; padding: 2px 22px 2px 2px;
      flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; overflow: hidden;
      height: 100%; box-sizing: border-box;
    }
    .magik-duration-chips .magik-chip {
      min-width: 0; min-height: 0; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--magik-acc, #f66744) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--magik-acc, #f66744) 42%, transparent);
      border-radius: 4px; color: rgba(255,255,255,0.72);
      font-size: 12px; padding: 2px 4px; cursor: pointer; text-align: center; line-height: 1.1;
      white-space: nowrap; overflow: hidden;
    }
    .magik-duration-chips .magik-chip:hover { background: color-mix(in srgb, var(--magik-acc, #f66744) 32%, transparent); border-color: var(--magik-acc, #f66744); color: #ddd; }
    .magik-duration-chips .magik-chip.magik-active,
    .magik-duration-chips .magik-chip.magik-active:hover {
      background: var(--magik-acc, #f66744); border-color: var(--magik-acc, #f66744); color: #fff;
    }
    .magik-duration-chips .magik-gear {
      position: absolute; right: 3px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; padding: 0; margin: 0; line-height: 0;
      background: none; border: none; cursor: pointer; color: #bbb;
    }
    .magik-duration-chips .magik-gear:hover { color: var(--magik-acc, #f66744); }
    .magik-duration-chips .magik-gear svg { display: block; width: 14px; height: 14px; fill: currentColor; }
    .magik-duration-preview {
      height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 5px;
      padding: 0 2px; font-size: 11px; line-height: 1.2; color: var(--magik-acc, #f66744);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .magik-duration-preview .magik-dim { color: rgba(255,255,255,0.42); }
    .magik-duration-preview .magik-warn { color: #e8694a; }
    .magik-dur-panel { position: fixed; z-index: 10010; width: 300px; max-width: 94vw; background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,0.6); color: #d8d8d8; font: 12px 'Segoe UI', sans-serif; }
    .magik-dur-head { display: flex; align-items: center; padding: 8px 10px; background: #232323; border-bottom: 1px solid #333; }
    .magik-dur-head b { color: var(--magik-acc, #f66744); font-weight: 600; }
    .magik-dur-x { margin-left: auto; cursor: pointer; color: #8a8a8a; padding: 0 4px; }
    .magik-dur-x:hover { color: #fff; }
    .magik-dur-body { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .magik-dur-lab { font-size: 11px; color: #8a8a8a; margin-bottom: 4px; }
    .magik-dur-recipes { display: flex; flex-wrap: wrap; gap: 4px; }
    .magik-dur-recipes button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; color: rgba(255,255,255,0.72); font-size: 12px; padding: 4px 8px; cursor: pointer; }
    .magik-dur-recipes button:hover { border-color: var(--magik-acc, #f66744); color: #ddd; }
    .magik-dur-recipes button.on { background: var(--magik-acc, #f66744); border-color: var(--magik-acc, #f66744); color: #fff; }
    .magik-dur-rule { height: 1px; background: #333; }
    .magik-dur-chips-input { width: 100%; box-sizing: border-box; background: #1d1d1d; border: 1px solid #444; border-radius: 4px; padding: 6px 8px; color: #e0e0e0; font: 12px monospace; outline: none; }
    .magik-dur-chips-input:focus { border-color: var(--magik-acc, #f66744); }
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
  });
  widget.serializeValue = () => undefined;   // DOM only, never saved in the widget
  widget.computedHeight = 28;
  // row sizing read by the frontend's widget grid: minimum only, no maximum,
  // so this row absorbs all the free space the node has left over
  element.style.setProperty("--comfy-widget-min-height", "28px");

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

const ALL_RECIPES = [...Object.keys(RECIPES), "Custom formula", "Manual"];

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
    for (const name of ALL_RECIPES) {
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
      commit();
      closeSettingsPanel();
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
  });
  widget.serializeValue = () => undefined;
  widget.computedHeight = 16;
  // fixed 16px row: min = max, so the grid gives this row exactly its height
  // and hands the rest of the node to the chips row below it
  element.style.setProperty("--comfy-widget-min-height", "16px");
  element.style.setProperty("--comfy-widget-max-height", "16px");
  element.style.setProperty("--comfy-widget-height", "16px");

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
    const widget = node.widgets?.find((w) => w.name === name);
    if (!widget) continue;
    if (widget._magikOriginalType === undefined) {
      widget._magikOriginalType = widget.type;
      widget._magikSavedHeight = widget.computedHeight || 30;
    }
    widget.type = visible[name] ? widget._magikOriginalType : "hidden";
    widget.hidden = !visible[name];
    widget.computedHeight = visible[name] ? widget._magikSavedHeight : 0;
    if (widget.element) widget.element.style.display = visible[name] ? "" : "none";
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
  stretchChips(node);
}

// Lay the chips out as a grid of near-square tiles that fills the whole row,
// then size each label to the largest font that fits inside its own button:
// vertically (line box must fit the button height) and horizontally (text
// width must fit the button width), so labels fill the buttons without
// ever spilling out of them.
function fitChips(el) {
  const chips = [...el.querySelectorAll(".magik-chip")];
  const n = chips.length;
  const w = el.clientWidth - 24;   // minus the row's horizontal padding
  const h = el.clientHeight - 4;   // minus the row's vertical padding
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
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const line = parseFloat(cs.lineHeight) || 1.1;
    let fs = Math.max(8, (btn.clientHeight - padY) / line);
    btn.style.fontSize = fs + "px";
    for (let i = 0; i < 4 && btn.scrollWidth > btn.clientWidth && fs > 8; i++) {
      fs = Math.max(8, Math.floor((fs * btn.clientWidth) / btn.scrollWidth));
      btn.style.fontSize = fs + "px";
    }
  }
}

// Give the chips row all the height the node has left over, so the buttons
// fill the panel below the readout and grow when the node is resized taller.
function stretchChips(node) {
  const widgets = node.widgets || [];
  const chipsIdx = widgets.findIndex((w) => w.name === "magik_duration_chips");
  if (chipsIdx < 0 || !Array.isArray(node.size)) return;
  const chips = widgets[chipsIdx];
  const el = chips.element;
  let used = node.widgets_start_y ?? 30;
  for (const w of widgets) {
    if (w === chips) break;
    if (w.type === "hidden" || w.hidden) continue;
    used += w.computedHeight || 30;
  }
  for (let i = chipsIdx + 1; i < widgets.length; i++) {
    if (widgets[i].type === "hidden" || widgets[i].hidden) continue;
    used += widgets[i].computedHeight || 30;
  }
  const h = Math.max(28, Math.min(Math.round(node.size[1] - used - 4), Math.round(node.size[1])));
  chips.computedHeight = h;
  if (el) {
    el.style.height = h + "px";
    el.style.setProperty("--comfy-widget-height", h + "px");
    el.style.setProperty("--comfy-widget-min-height", "28px");
    fitChips(el);
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
      const key = JSON.stringify(widgetValues(this)) + "|" + (this.size?.[0] ?? 0) + "x" + (this.size?.[1] ?? 0);
      if (key !== last) { last = key; repaintExtras(this); stretchChips(this); }
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

    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = _resize?.apply(this, arguments);
      stretchChips(this);
      return r;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (_panelNode === this) closeSettingsPanel();
      return _removed?.apply(this, arguments);
    };
  },
});

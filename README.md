# Magik Duration

**One node: pick how long your video should be, get the frame count your model actually accepts.**

Part of the [Magik](https://github.com/IA-gyz) ComfyUI node collection.

Ported from Pixaroma's excellent Duration node
([ComfyUI-Pixaroma](https://github.com/pixaroma/ComfyUI-Pixaroma), MIT License),
rewritten self-contained for the Magik collection. Thanks to pixaroma for
open-sourcing it under MIT.

## What it does

Video models are fussy about length. Most will not accept just any frame
count: they want it to land on a particular pattern.

| Model        | Pattern    | fps |
| ------------ | ---------- | --- |
| MiniMax H3   | 17n + 5    | 24  |
| Wan 2.x      | 4n + 1     | 16  |
| Hunyuan      | 4n + 1     | 24  |
| LTX          | 8n + 1     | 24  |
| Plain frames | no snap    | 24  |

Pick a recipe and the node handles the pattern: **5 seconds at 24 fps becomes
124 frames** for MiniMax H3, which is really 5.17 s.

The maths is three steps: `frames = round(seconds x fps)`, raised to the
model's minimum, then snapped **up** to the next `step x n + plus` (never down,
and never below `plus`). A clip a few frames long is always safer than one the
sampler refuses.

## Outputs

- **frames** (INT): the frame count, snapped up to the model's pattern. Wire it
  into your video node's length input.
- **seconds** (FLOAT): the TRUE length (frames / fps). Snapping changes it a
  little, so anything timed against the video (audio, captions) needs this
  figure, not the number you picked.

## Modes

- **Recipe**: picking a recipe in the gear's settings panel copies its
  fps / step / plus / min-frames onto the node, so a saved workflow never
  changes retroactively if a recipe is updated later. It is a starting point,
  not a live link: edit one of the numbers by hand and the node switches to
  Manual.
- **Manual**: edit the numbers yourself for a model that is not listed.
- **Custom formula**: write your own expression, e.g. `(a * fps / 4 + 1) * 4
  + 1`. Uses the same safe evaluator (simpleeval) and function allow-list as
  ComfyUI's Math Expression node; the variables are `a`, `seconds` and `fps`.
  The result is rounded to a whole number (0 to 1,000,000) and is **not**
  snapped to any pattern: the formula is in charge. A formula that is empty,
  longer than 500 characters or fails to evaluate falls back to the numbers on
  the node instead of failing the run.

## On the canvas (js/magik_duration.js)

- Quick duration chips in the style of Pixaroma's Duration node (default
  3/5/10 s), laid out as a grid of near-square buttons that fills the bottom of
  the node. Each label grows to the largest size that still fits inside its own
  button, and is re-fitted whenever you resize the node. Click the gear (or
  double-click the chips row) to open a settings panel with two sections: a
  recipe picker and a quick-durations field (comma-separated seconds; Enter applies it,
  and an invalid list stays open so you can fix it).
- A live preview line: "5 s -> 124 frames (really 5.17 s)", with the true length
  dimmed when snapping changed it. In Custom formula mode it reads "frames set
  by formula": only Python evaluates a formula, so the browser shows no count
  that could disagree with the run. The `seconds` output still carries the true
  length.
- The recipe and seconds widgets are always hidden on the canvas (the gear and
  the chips replace them). fps / step / plus / min-frames / formula only appear
  for Manual or Custom formula, where they must be editable. Hidden widgets
  still save their values with the workflow.
- The frontend sizes the rows: the readout is a fixed 16px and the chips row
  takes all the remaining height, so nothing in the extension measures or
  guesses layout. Both rows keep a margin at least as large as the frontend's
  resize grab zones (read from `LGraphNode.resizeHandleSize`, 15px), so the
  bottom corners and the sides stay grabbable.

The Python side reads the widget values directly, so the numbers on the node
are always what runs; the browser extras are a convenience layer on top of them.

## Install

Clone into `ComfyUI/custom_nodes` and restart:

```
git clone https://github.com/IA-gyz/comfyui-magik-duration.git
```

No dependencies. simpleeval is used (like ComfyUI core) when a custom formula
is set; without it, Custom formula mode falls back to the numbers on the node.

## Troubleshooting

**Only the plain widgets show, no chips, gear or preview line.** The extension
did not load. Restart ComfyUI, hard-refresh the page (Ctrl+Shift+R; browsers
cache extension scripts), and check the browser console: a failed load names the
file. The extension is one self-contained file (`js/magik_duration.js`), so a
missing second file cannot cause this; a stale cached copy can.

## Tests

```
python -m unittest discover -s tests -v
```

- The browser's frame maths (the marked block in `js/magik_duration.js`) is
  compared with Python over thousands of inputs, including banker's rounding and out-of-range values
  (needs `node`; skipped without it).
- Snapping is checked to always land on the `step x n + plus` grid, never below
  `plus`.
- The recipe table in this README and the one in `js/magik_duration.js` are
  checked against the recipes in `magik_duration.py`, so the three cannot drift.
- The extension must stay a single file with no sibling imports, and both rows
  must keep margins that leave the node's resize corners free.

## Files

| File | Role |
| ---- | ---- |
| `magik_duration.py` | The node and the recipes. |
| `duration_helpers.py` | The frame maths and the formula evaluator (pure, no ComfyUI). |
| `js/magik_duration.js` | Chips, gear panel and live preview (one self-contained file). |
| `tests/` | The checks above. |

## License

MIT. Derived in part from ComfyUI-Pixaroma (Copyright (c) 2026 pixaroma), also
MIT: see LICENSE.

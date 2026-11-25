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

Pick a recipe from the dropdown and the node handles the pattern: **5 seconds
at 24 fps becomes 124 frames** for MiniMax H3, which is really 5.17 s.

## Outputs

- **frames** (INT): the frame count, snapped up to the model's pattern. Wire it
  into your video node's length input.
- **seconds** (FLOAT): the TRUE length (frames / fps). Snapping changes it a
  little, so anything timed against the video (audio, captions) needs this
  figure, not the number you picked.

## Modes

- **Recipe**: copies the model's fps/step/plus/min-frames onto the
  node so a saved workflow never changes retroactively. Pick one from the
  gear's settings panel on the node (or set the `recipe` widget via API); it is
  a starting point, not a live link.
- **Manual**: edit the numbers yourself for a model that is not listed.
- **Custom formula**: write your own expression, e.g. `(a * fps / 4 + 1) * 4
  + 1`. Uses the same safe evaluator (simpleeval) and function allow-list as
  ComfyUI's Math Expression node; the variables are `a`, `seconds` and `fps`.
  A broken formula falls back to the numbers on the node instead of failing
  the run.

## Frontend extras (js/magik_duration.js)

- Quick duration chips in the style of Pixaroma's Duration node (default
  3/5/10 s), pinned to the bottom of the node. The readout row is kept to a
  minimal height and the chips row takes the rest of the node, so the buttons
  occupy most of the panel; the labels grow to the largest size that still
  fits inside their button (height and width). Click the gear (or double-click
  the chips row) to open a settings panel with two separate sections: a recipe
  picker and a quick-durations field.
- A live preview line in the same style: "5 s → 124 frames (really 5.17 s)",
  with the true length dimmed when snapping changed it.
- The Python widgets (recipe, seconds, fps, step, plus, min-frames, formula)
  are hidden on the canvas: the chips set seconds, and the gear's settings
  panel edits the recipe and the chip list. fps/step/plus/min-frames/formula only appear for
  Manual or Custom formula, where they must be editable. Hidden widgets still
  save their values, so nothing changes for scripts or the API.

Everything is plain widgets, so workflows driven by scripts or the API work
with no browser at all.

## Install

Clone into `ComfyUI/custom_nodes` and restart:

```
git clone https://github.com/IA-gyz/comfyui-magik-duration.git
```

No dependencies. simpleeval is used (like ComfyUI core) when a custom formula
is set; without it, the custom mode falls back to the recipe numbers.

## License

MIT. Derived in part from ComfyUI-Pixaroma (Copyright (c) 2026 pixaroma), also
MIT: see LICENSE.

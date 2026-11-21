"""Magik Duration - pick a length in seconds, send the frame count.

Ported from Pixaroma's Duration node (ComfyUI-Pixaroma, MIT License,
Copyright (c) 2026 pixaroma).

Unlike the original, the settings are plain widgets (recipe, seconds, fps,
step, plus, min frames, formula) so a workflow saved as API / driven by scripts
works with no browser at all: the Python side reads the widgets directly.
The js extension (js/magik_duration.js) adds the comfortable parts on top:
duration buttons, a model recipe picker that fills the numbers, editable
chips and a live preview of the frames and true seconds before you run.
"""

from .duration_helpers import (
    DEFAULTS,
    frames_from_formula,
    frames_from_seconds,
    _num,
)

RECIPES = {
    "MiniMax H3": {"fps": 24.0, "step": 17, "plus": 5, "min_frames": 5},
    "Wan 2.x": {"fps": 16.0, "step": 4, "plus": 1, "min_frames": 1},
    "Hunyuan": {"fps": 24.0, "step": 4, "plus": 1, "min_frames": 1},
    "LTX": {"fps": 24.0, "step": 8, "plus": 1, "min_frames": 1},
    "Plain frames": {"fps": 24.0, "step": 1, "plus": 0, "min_frames": 1},
    "Custom formula": None,   # uses the formula widget
    "Manual": None,           # keeps whatever numbers are on the node
}


class MagikDuration:
    DESCRIPTION = (
        "Pick how long a video should be in seconds, and this works out the frame "
        "count the model actually wants. Ported from Pixaroma's Duration node.\n\n"
        "Video models are fussy about length: most want the frame count to land "
        "on a particular pattern, like every 17th frame plus 5 for MiniMax H3, or "
        "every 4th frame plus 1 for Wan and Hunyuan. Pick your model from the "
        "recipe list and the node handles the pattern for you. Edit the numbers "
        "yourself for a model that is not listed, or switch to Custom formula "
        "and write your own expression (same functions as ComfyUI's Math "
        "Expression node, using a, seconds and fps).\n\n"
        "The seconds output is the TRUE length: frames divided by fps, because "
        "snapping to the model's pattern usually changes it a little. 5 seconds "
        "at 24 fps becomes 124 frames, which is really 5.17 seconds."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "recipe": (list(RECIPES.keys()),),
                "seconds": (
                    "FLOAT",
                    {"default": 5.0, "min": 0.0, "max": 100000.0, "step": 0.1},
                ),
                "fps": (
                    "FLOAT",
                    {"default": 24.0, "min": 0.0, "max": 1000.0, "step": 0.01},
                ),
                "step": ("INT", {"default": 17, "min": 0, "max": 100000}),
                "plus": ("INT", {"default": 5, "min": 0, "max": 100000}),
                "min_frames": ("INT", {"default": 5, "min": 0, "max": 1000000}),
                "formula": (
                    "STRING",
                    {"default": "", "multiline": True},
                ),
            },
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("frames", "seconds")
    OUTPUT_TOOLTIPS = (
        "The number of frames to generate, already adjusted to the pattern your "
        "model accepts. Wire this into the length or frame count input of your "
        "video node.",
        "How long the video will really be, in seconds: the frame count divided "
        "by the frame rate. It can differ slightly from the number you picked, "
        "because rounding to the model's pattern changes the length a little.",
    )
    FUNCTION = "run"
    CATEGORY = "magik/Values"

    def run(self, recipe, seconds, fps, step, plus, min_frames, formula):
        # The recipe widget is a PICKER, not config: choosing one in the browser
        # copies its numbers onto the fps/step/plus/min_frames widgets, which
        # are the real inputs. A script or API call can therefore set either the
        # recipe (and the defaults it stands for via the widget values it saved)
        # or the raw numbers, and both paths agree.
        if recipe == "Custom formula" and isinstance(formula, str) and formula.strip():
            frames = frames_from_formula(formula, seconds, fps)
            if frames is not None:
                fps_clamped = _num(fps, DEFAULTS["fps"], 0.0, 1000.0)
                actual = (frames / fps_clamped) if fps_clamped > 0 else 0.0
                return (frames, float(actual))
            # A broken custom formula falls back to the recipe numbers so a
            # typo never fails the whole run.
        frames = frames_from_seconds(seconds, fps, step, plus, min_frames)
        fps_clamped = _num(fps, DEFAULTS["fps"], 0.0, 1000.0)
        actual = (frames / fps_clamped) if fps_clamped > 0 else 0.0
        return (frames, float(actual))


NODE_CLASS_MAPPINGS = {"MagikDuration": MagikDuration}
NODE_DISPLAY_NAME_MAPPINGS = {"MagikDuration": "Magik Duration"}

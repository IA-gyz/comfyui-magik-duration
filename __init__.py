"""Magik Duration: pick a length in seconds, send the frame count the model wants.

Ported from Pixaroma's Duration node (ComfyUI-Pixaroma, MIT License,
Copyright (c) 2026 pixaroma).

Nodes: MagikDuration ("Magik Duration") in magik/Values.
"""

from .magik_duration import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
__version__ = "1.0.0"

WEB_DIRECTORY = "js"

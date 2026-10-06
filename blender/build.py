"""Rebuild Mr. Fyre in Blender and render the sprites.

From the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py

or inside Blender: open this file in the Text editor and Run Script.

Options go after a `--`:

    --no-render        rebuild the .blend only
    --render-only      keep the model as it is (hand edits included), just render
    --only a,b         render just these poses
    --scale 2          render at twice the resolution
    --out DIR          where the sprites go (default: blender/renders/mr-fyre)
"""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path(bpy.data.filepath).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import mrfyre.model  # noqa: E402
import mrfyre.poses  # noqa: E402
import mrfyre.scene  # noqa: E402

# Blender keeps modules alive between runs; pick up edits to the libraries.
for module in (mrfyre.model, mrfyre.poses, mrfyre.scene):
    importlib.reload(module)


def main(argv: list[str]) -> dict:
    parser = argparse.ArgumentParser(prog="build.py")
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--only", default="")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--out", type=Path, default=HERE / "renders" / "mr-fyre")
    args = parser.parse_args(argv)

    report: dict = {}
    if not args.render_only:
        report["built"] = mrfyre.scene.build()
    if not args.no_render:
        only = {name for name in args.only.split(",") if name} or None
        report["rendered"] = mrfyre.scene.render(args.out, args.scale, only)
    if bpy.data.filepath and not args.render_only:
        bpy.ops.wm.save_mainfile()
        report["saved"] = bpy.data.filepath
    return report


if __name__ == "__main__":
    result = main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    print(result)

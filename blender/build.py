"""Rebuild Mr. Fyre in Blender and draw his sprites.

From the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py

or inside Blender: open this file in the Text editor and Run Script.

Options go after a `--`:

    --no-render        rebuild the .blend only
    --render-only      keep the model as it is (hand edits included), just draw
    --only a,b         draw just these poses
    --moves "a>b,..."  draw these moves between poses as well; `a>b:left` or
                       `a>b:right` is a move that also carries him that way
    --moves-for FILE   draw the moves a video makes: every change of `pose:`
                       in FILE, in the order they are written
    --scale 2          draw at twice the resolution
    --out DIR          where the sprites go (default: blender/renders/mr-fyre)
"""

from __future__ import annotations

import argparse
import importlib
import re
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path(bpy.data.filepath).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import mrfyre.model  # noqa: E402
import mrfyre.motion  # noqa: E402
import mrfyre.poses  # noqa: E402
import mrfyre.scene  # noqa: E402
import mrfyre.swing  # noqa: E402

# Blender keeps modules alive between runs; pick up edits to the libraries.
for module in (mrfyre.model, mrfyre.poses, mrfyre.swing, mrfyre.scene, mrfyre.motion):
    importlib.reload(module)


def moves_asked(listed: str, video: Path | None) -> list[tuple[str, str, str | None]]:
    """The moves to draw: those listed, and those a video's cue sheet makes."""
    pairs: list[tuple[str, str, str | None]] = []
    for item in filter(None, listed.split(",")):
        move, _, travel = item.partition(":")
        start, _, end = move.partition(">")
        pairs.append((start.strip(), end.strip(), travel.strip() or None))
    if video is not None:
        poses = re.findall(r"""pose["']?\s*[:=]\s*["']([\w-]+)["']""", video.read_text())
        pairs += [(start, end, None) for start, end in zip(poses, poses[1:]) if start != end]
    unknown = {name for start, end, _ in pairs for name in (start, end)} - set(mrfyre.poses.POSES)
    if unknown:
        raise SystemExit(f"No such pose: {', '.join(sorted(unknown))}")
    return list(dict.fromkeys(pairs))


def main(argv: list[str]) -> dict:
    parser = argparse.ArgumentParser(prog="build.py")
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--only", default="")
    parser.add_argument("--moves", default="")
    parser.add_argument("--moves-for", type=Path)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--out", type=Path, default=HERE / "renders" / "mr-fyre")
    args = parser.parse_args(argv)

    report: dict = {}
    pairs = moves_asked(args.moves, args.moves_for)
    if not args.render_only:
        report["built"] = mrfyre.scene.build()
    if not args.no_render:
        only = {name for name in args.only.split(",") if name} or None
        # Asked only for moves, the poses are left as they are.
        if only or not pairs or not args.render_only:
            report["rendered"] = mrfyre.scene.render(args.out, args.scale, only)
        if pairs:
            report["moves"] = mrfyre.motion.moves(pairs, args.out, args.scale)
    if bpy.data.filepath and not args.render_only:
        bpy.ops.wm.save_mainfile()
        report["saved"] = bpy.data.filepath
    return report


if __name__ == "__main__":
    result = main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    print(result)

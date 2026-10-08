"""Movement.

He goes from one pose to the next in a few frames, and the tie and the coat
(`swing.py`) trail behind and settle.

A move is drawn once, as the frames from one pose to the next until
everything has come to rest, and kept under `moves/<from>__<to>/`. The studio
plays it when a cue changes his pose and then holds the pose's own sprite, so
a video can be retimed without drawing anything again.
"""

from __future__ import annotations

import json
from pathlib import Path

from mathutils import Vector

from . import scene
from .model import UNIT
from .swing import Swings

# How many frames a change of pose takes, at 30 a second.
TAKE = 9
# How long the cloth is given to settle once he has stopped, and over how many
# of those frames, the last ones, it is drawn in to rest.
SETTLE = (26, 10)
# A move that also carries him across the picture: he is taken to travel this
# far, in character units, over this many frames. The studio does the
# travelling; here it is only what the tie and the coat feel.
TRAVEL = (3.0, 24)

def ease(t: float) -> float:
    """Fast out of the old pose, a touch past the new one, and back."""
    if t >= 1:
        return 1.0
    over = 1.3
    return 1 + (over + 1) * (t - 1) ** 3 + over * (t - 1) ** 2


def glide(t: float) -> float:
    """Where a travelling move has got to: gently off, gently in."""
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def _name(start: str, end: str, travel: str | None) -> str:
    return f"{start}__{end}" + (f"__{travel}" if travel else "")


def move(start: str, end: str, out: Path, travel: str | None = None) -> int:
    """Draw the move from one pose to another under `out`, and return how many frames it took.

    `travel` — "left" or "right" — is for a move that also carries him across
    the picture: the cloth trails behind and swings forward when he stops.
    """
    folder = out / "moves" / _name(start, end, travel)
    for stale in folder.glob("*.png") if folder.exists() else ():
        stale.unlink()
    before, after = scene.state(start), scene.state(end)
    swings = Swings()
    direction = {None: 0.0, "left": -1.0, "right": 1.0}[travel]
    distance, over = TRAVEL
    frames: list[dict] = []
    with scene.posing():
        scene.apply(before)
        swings.step(settle=True)
        stopped = max(TAKE, over if travel else 0)
        moving = 1.0
        for index in range(stopped + SETTLE[0]):
            scene.apply(scene.blend(before, after, ease((index + 1) / TAKE)))
            shift = Vector((direction * distance * UNIT * glide((index + 1) / over), 0.0, 0.0))
            # Still enough to stop early: one last frame, drawn right in to rest.
            done = index + 1 >= stopped + 2 and moving < 0.008
            home = 1.0 if done else (index + 2 - (stopped + SETTLE[0] - SETTLE[1])) / SETTLE[1]
            moving = swings.step(shift, home=max(0.0, home))
            frames.append({"brows": scene.brows()})
            scene.draw(folder / f"{index:02d}.png")
            if done:
                break
    told = {"from": start, "to": end, "travel": travel, "travelFrames": over if travel else 0, "frames": frames}
    (folder / "move.json").write_text(json.dumps(told) + "\n")
    return len(frames)


def moves(pairs: list[tuple[str, str, str | None]], out: Path, scale: float = 1.0) -> dict[str, int]:
    """Draw each of the moves asked for."""
    scene.prepare(scale)
    done: dict[str, int] = {}
    try:
        for start, end, travel in pairs:
            done[_name(start, end, travel)] = move(start, end, out, travel)
    finally:
        scene.prepare(1.0)
    return done

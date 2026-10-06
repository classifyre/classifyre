"""Stages the model, poses it, and draws it.

The drawing is not a render of light on surfaces. Blender is only asked which
part is in front at every pixel (`_parts`); from that map `_drawing` fills
paper white and ink black, and puts a line of one fixed width along every
border between two parts and between a part and the background. So there is
no shading, and the line weighs the same everywhere.
"""

from __future__ import annotations

import json
import math
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from .model import BROWS, COLLECTION, RIG, UNIT, Model
from .poses import EMOTIONS, POSES

PIXELS_PER_UNIT = 128
# The canvas, in character units: (left, bottom, right, top). Every pose is
# drawn on the same canvas, feet on the same spot, so poses swap in place.
CANVAS = (-6.25, -1.0, 6.25, 11.5)
# The weight of the line, in character units.
LINE = 0.1
# The part map is taken this many times larger than the sprite and averaged
# down, which is what smooths the edges.
OVERSAMPLE = 2
# He wears the hat at a slant, screen-right side up. Degrees, added to every pose.
HAT_TILT = 8.0
CAMERA = "MrFyre.camera"
FRAME_STEP = 10
HANDS = ("fist", "open", "point")


def frame_of(index: int) -> int:
    return (index + 1) * FRAME_STEP


def _size(scale: float) -> tuple[int, int]:
    left, bottom, right, top = CANVAS
    return (round((right - left) * PIXELS_PER_UNIT * scale), round((top - bottom) * PIXELS_PER_UNIT * scale))


def _settings(scene: bpy.types.Scene, scale: float = 1.0) -> None:
    """A flat, unlit, unsmoothed picture of object colours: a map of the parts."""
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "OBJECT"
    shading.show_backface_culling = False
    shading.show_shadows = False
    shading.show_cavity = False
    shading.show_object_outline = False
    scene.display.render_aa = "OFF"
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = _size(scale * OVERSAMPLE)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 15
    scene.render.dither_intensity = 0.0
    # The colours are codes, not colours: they must come out as they went in.
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"


def _camera(collection: bpy.types.Collection) -> bpy.types.Object:
    """Straight on and orthographic: perspective is what gives 3D away."""
    left, bottom, right, top = CANVAS
    old = bpy.data.objects.get(CAMERA)
    if old is not None:
        bpy.data.objects.remove(old)
    camera = bpy.data.objects.new(CAMERA, bpy.data.cameras.new(CAMERA))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(right - left, top - bottom) * UNIT
    camera.location = ((left + right) / 2 * UNIT, -10.0, (bottom + top) / 2 * UNIT)
    camera.rotation_euler = (math.radians(90), 0.0, 0.0)
    collection.objects.link(camera)
    return camera


def _code_parts() -> None:
    """Give every part a colour that says which group it is in, and whether it is ink.

    Red and green together number the group; blue is 1 for paper, 0 for ink.
    """
    parts = [obj for obj in bpy.data.objects if "fyre_group" in obj]
    groups = sorted({obj["fyre_group"] for obj in parts})
    for obj in parts:
        number = groups.index(obj["fyre_group"])
        obj.color = ((number % 9 + 1) / 10, (number // 9 + 1) / 10, 0.0 if obj["fyre_ink"] else 1.0, 1.0)


def _show_in_viewport() -> None:
    """In the viewport he is an ordinary lit 3D model, so his form can be seen and worked on."""
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                shading = area.spaces.active.shading
                shading.type = "SOLID"
                shading.light = "STUDIO"
                shading.color_type = "MATERIAL"
                shading.show_object_outline = True
                area.spaces.active.region_3d.view_perspective = "CAMERA"


def pose(name: str) -> None:
    """Put the rig in a pose from the library."""
    rig = bpy.data.objects[RIG]
    spec = POSES[name]
    for bone in rig.pose.bones:
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_euler = (0.0, 0.0, 0.0)
    for control, how in spec.items():
        if control == "hands":
            continue
        bone = rig.pose.bones[control]
        if "at" in how:
            bone.location = Vector(how["at"]) * UNIT - bone.bone.head_local
        if "move" in how:
            bone.location = Vector(how["move"]) * UNIT
        if "turn" in how:
            bone.rotation_euler = [math.radians(v) for v in how["turn"]]
    rig.pose.bones["hat"].rotation_euler.y -= math.radians(HAT_TILT)
    hands = {"L": "fist", "R": "fist", **spec.get("hands", {})}
    for side, tag in ((-1, "L"), (1, "R")):
        hand, elbow = rig.pose.bones[f"hand.{tag}"], rig.pose.bones[f"elbow.{tag}"]
        reach = (hand.bone.head_local + hand.location) - (elbow.bone.head_local + elbow.location)
        along = Vector((reach.x, reach.z)).normalized()
        # Which way round the hand goes: thumb up, or failing that towards his body.
        mirrored = -side * along.x - 0.5 * along.y < 0
        for obj in _hands():
            _, shape, obj_tag = obj.name.split(".")[:3]
            if obj_tag != tag:
                continue
            obj.hide_render = obj.hide_viewport = hands[tag] != shape
            obj.scale.x = -1.0 if mirrored else 1.0
            obj.location.x = 2 * hand.bone.head_local.x if mirrored else 0.0


def _hands() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.name.startswith("hand.")]


def emotion(name: str) -> None:
    rig = bpy.data.objects[RIG]
    for side, tag, (roll, lift) in zip((-1, 1), ("L", "R"), EMOTIONS[name]):
        brow = rig.pose.bones[f"brow.{tag}"]
        # Looking along +Y, a positive turn is clockwise in the picture.
        brow.rotation_euler = (0.0, math.radians(side * roll), 0.0)
        brow.location = (0.0, 0.0, lift * UNIT)


def build() -> dict:
    """(Re)create the model in the open .blend and key every pose on the timeline."""
    scene = bpy.context.scene
    model = Model()
    _code_parts()
    _settings(scene)
    scene.camera = _camera(model.collection)
    rig = model.rig.obj
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    preferences = bpy.context.preferences.edit
    before = preferences.keyframe_new_interpolation_type
    # A pose is held, not blended into the next one.
    preferences.keyframe_new_interpolation_type = "CONSTANT"
    try:
        for index, name in enumerate(POSES):
            frame = frame_of(index)
            pose(name)
            emotion("wry")
            for bone in rig.pose.bones:
                if bone.name in model.rig.CONTROLS:
                    bone.keyframe_insert("location", frame=frame)
                    bone.keyframe_insert("rotation_euler", frame=frame)
            for hand in _hands():
                for path in ("hide_render", "hide_viewport", "location", "scale"):
                    hand.keyframe_insert(path, frame=frame)
            scene.timeline_markers.new(name, frame=frame)
    finally:
        preferences.keyframe_new_interpolation_type = before
    scene.frame_start, scene.frame_end = frame_of(0), frame_of(len(POSES) - 1)
    scene.frame_set(frame_of(0))
    _show_in_viewport()
    # Each rebuild replaces every mesh; drop the ones it replaced.
    bpy.data.orphans_purge(do_recursive=True)
    return {"poses": list(POSES), "emotions": list(EMOTIONS)}


# -- drawing ----------------------------------------------------------------


def _parts(scene: bpy.types.Scene) -> np.ndarray:
    """The part map of the scene as it stands: rows × columns × RGBA, bottom row first."""
    path = Path(tempfile.gettempdir()) / "mrfyre-parts.png"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)


def _thicken(mask: np.ndarray, steps: int) -> np.ndarray:
    """Grow a mask outward by about `steps` pixels, evenly in every direction."""
    out = mask
    for step in range(steps):
        grown = out.copy()
        grown[1:] |= out[:-1]
        grown[:-1] |= out[1:]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        if step % 2:
            # Every other step takes the diagonals too: the growth comes out
            # eight-sided, close enough to round.
            grown[1:, 1:] |= out[:-1, :-1]
            grown[1:, :-1] |= out[:-1, 1:]
            grown[:-1, 1:] |= out[1:, :-1]
            grown[:-1, :-1] |= out[1:, 1:]
        out = grown
    return out


def _drawing(parts: np.ndarray, line: bool) -> np.ndarray:
    """A part map turned into the picture: white paper, black ink, one weight of line."""
    there = parts[..., 3] > 0.5
    group = (np.rint(parts[..., 0] * 10) * 10 + np.rint(parts[..., 1] * 10)).astype(np.int16)
    group[~there] = -1
    ink = there & (parts[..., 2] < 0.5)
    lines = np.zeros_like(there)
    if line:
        # A border is where a pixel and its neighbour are different things.
        up = (slice(None, -1), slice(None)), (slice(1, None), slice(None))
        across = (slice(None), slice(None, -1)), (slice(None), slice(1, None))
        for one, other in (up, across):
            border = group[one] != group[other]
            lines[one] |= border
            lines[other] |= border
        height = parts.shape[0]
        lines = _thicken(lines, round(LINE / 2 * height / (CANVAS[3] - CANVAS[1])) - 1)
    white = there & ~ink & ~lines
    solid = there | lines

    def averaged(mask: np.ndarray) -> np.ndarray:
        rows, columns = mask.shape[0] // OVERSAMPLE, mask.shape[1] // OVERSAMPLE
        return mask.reshape(rows, OVERSAMPLE, columns, OVERSAMPLE).mean(axis=(1, 3), dtype=np.float32)

    alpha = averaged(solid)
    value = np.divide(averaged(white), alpha, out=np.zeros_like(alpha), where=alpha > 0)
    return np.stack([value, value, value, alpha], axis=-1)


def _save(picture: np.ndarray, path: Path) -> None:
    height, width, _ = picture.shape
    image = bpy.data.images.new("mrfyre-sprite", width, height, alpha=True)
    image.pixels.foreach_set(picture.ravel())
    path.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def render(out: Path, scale: float = 1.0, only: set[str] | None = None) -> int:
    """Draw transparent sprites under `out`: `body/<pose>.png`, and the brows
    alone as `brows/<pose>__<emotion>.png`, to be laid over it."""
    scene = bpy.context.scene
    _code_parts()
    _settings(scene, scale)
    body, brows = bpy.data.collections[COLLECTION], bpy.data.collections[BROWS]
    count = 0
    try:
        for index, name in enumerate(POSES):
            if only and name not in only:
                continue
            scene.frame_set(frame_of(index))
            pose(name)
            body.hide_render, brows.hide_render = False, True
            _save(_drawing(_parts(scene), line=True), out / "body" / f"{name}.png")
            # The brows alone. The body is hidden a collection at a time: the
            # hands' own visibility is keyed, and would come straight back.
            body.hide_render, brows.hide_render = True, False
            for mood in EMOTIONS:
                emotion(mood)
                _save(_drawing(_parts(scene), line=False), out / "brows" / f"{name}__{mood}.png")
            count += 1 + len(EMOTIONS)
    finally:
        body.hide_render = brows.hide_render = False
        emotion("wry")
        _settings(scene)
        scene.frame_set(frame_of(0))
    if not only:
        width, height = _size(1.0)
        manifest = {
            "pixelsPerUnit": PIXELS_PER_UNIT,
            "width": width,
            "height": height,
            # The point on the ground he stands over.
            "origin": [round(-CANVAS[0] * PIXELS_PER_UNIT), round(CANVAS[3] * PIXELS_PER_UNIT)],
            "poses": {name: {} for name in POSES},
            "emotions": {name: {} for name in EMOTIONS},
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return count

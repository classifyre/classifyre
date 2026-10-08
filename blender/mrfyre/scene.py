"""Stages the model, poses it, and draws it.

The drawing is not a render of light on surfaces. Blender is asked two things
about every pixel: which part is in front, and how far away it is (`_parts`).
From that `_drawing` fills paper white and ink black, and puts a line of one
fixed width wherever two parts meet, wherever a part meets the background,
and wherever the distance jumps — one thing passing in front of another, a
sleeve across the coat, a finger across the palm. So there is no shading, and
the line weighs the same everywhere.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from .model import BROWS, RIG, UNIT, Model, Rig
from .poses import EMOTIONS, HANDS, POSES, STANCE
from .swing import Swings

PIXELS_PER_UNIT = 128
# The canvas, in character units: (left, bottom, right, top). Every pose is
# drawn on the same canvas, feet on the same spot, so poses swap in place.
CANVAS = (-6.5, -1.6, 6.5, 12.1)
# The weight of the ordinary line, in character units. A part can ask for a
# heavier or a lighter one (`line` in model.py): the coat's is heavier.
LINE = 0.06
# A fold, one thing crossing in front of itself, is drawn this much lighter
# than the outline of the part it is in.
FOLD = 0.75
# A jump in distance of more than this, in character units, is drawn as a line.
EDGE = 0.13
# A fold shorter than this, in character units, is a speck and is not drawn.
SPECK = 0.22
# The part map is taken this many times larger than the sprite and averaged
# down, which is what smooths the edges.
OVERSAMPLE = 2
# The camera looks level from this height and this far away, in character
# units. Level means uprights stay upright; near means what is below the eye
# is seen a little from above (the hem curves, the shoes show their tops) and
# what is above it from below (the brim shows its underside).
EYE = 6.9
DISTANCE = 17.0
# He wears the hat at a slant, screen-right side up, and pushed back a little.
# Degrees, added to every pose.
HAT_TILT = 8.0
HAT_BACK = 1.5
# How much of his lean across the picture the hat takes up: all of it would
# show the underside of the brim behind him when he runs.
HAT_LEAN = 0.5
CAMERA = "MrFyre.camera"
CODE = "Fyre parts"
FRAME_STEP = 10

State = dict[str, tuple[float, float, float]]


def frame_of(index: int) -> int:
    return (index + 1) * FRAME_STEP


def _size(scale: float) -> tuple[int, int]:
    left, bottom, right, top = CANVAS
    return (round((right - left) * PIXELS_PER_UNIT * scale), round((top - bottom) * PIXELS_PER_UNIT * scale))


def project(point: Vector) -> tuple[float, float]:
    """Where a point of him, in character units, lands on the sprite, in pixels from its top left."""
    left, _, _, top = CANVAS
    near = DISTANCE / (DISTANCE + point.y)
    return ((point.x * near - left) * PIXELS_PER_UNIT, (top - EYE - (point.z - EYE) * near) * PIXELS_PER_UNIT)


def _code() -> bpy.types.Material:
    """The material everything wears while its picture is taken. It is not a
    colour: red says which object, green how far away, blue whether it is
    seen from behind."""
    material = bpy.data.materials.get(CODE)
    if material is not None:
        bpy.data.materials.remove(material)
    material = bpy.data.materials.new(CODE)
    material.use_nodes = True
    material.use_backface_culling = False
    tree = material.node_tree
    tree.nodes.clear()
    which = tree.nodes.new("ShaderNodeObjectInfo")
    camera = tree.nodes.new("ShaderNodeCameraData")
    surface = tree.nodes.new("ShaderNodeNewGeometry")
    scale = tree.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY_ADD"
    # In character units, and small: the picture keeps few digits.
    scale.inputs[1].default_value = 1 / UNIT
    scale.inputs[2].default_value = 8.0 - DISTANCE
    mix = tree.nodes.new("ShaderNodeCombineColor")
    glow = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(camera.outputs["View Z Depth"], scale.inputs[0])
    tree.links.new(which.outputs["Object Index"], mix.inputs[0])
    tree.links.new(scale.outputs[0], mix.inputs[1])
    tree.links.new(surface.outputs["Backfacing"], mix.inputs[2])
    tree.links.new(mix.outputs[0], glow.inputs["Color"])
    tree.links.new(glow.outputs[0], out.inputs["Surface"])
    return material


def _settings(scene: bpy.types.Scene, scale: float = 1.0) -> None:
    """One unlit, unsmoothed sample a pixel, kept as numbers rather than colours."""
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 1
    scene.render.filter_size = 0.0
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = _size(scale * OVERSAMPLE)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    scene.render.use_compositing = False
    scene.render.use_sequencer = False


def _camera(collection: bpy.types.Collection) -> bpy.types.Object:
    left, bottom, right, top = CANVAS
    old = bpy.data.objects.get(CAMERA)
    if old is not None:
        bpy.data.objects.remove(old)
    camera = bpy.data.objects.new(CAMERA, bpy.data.cameras.new(CAMERA))
    camera.data.type = "PERSP"
    camera.data.sensor_fit = "HORIZONTAL"
    camera.data.angle = 2 * math.atan((right - left) / 2 / DISTANCE)
    # Looking level, the frame slid down to take in his feet: a shifted lens
    # rather than a tilted camera.
    camera.data.shift_x = (left + right) / 2 / (right - left)
    camera.data.shift_y = ((bottom + top) / 2 - EYE) / (right - left)
    camera.data.clip_start, camera.data.clip_end = 0.1, 100.0
    camera.location = (0.0, -DISTANCE * UNIT, EYE * UNIT)
    camera.rotation_euler = (math.radians(90), 0.0, 0.0)
    collection.objects.link(camera)
    return camera


def _code_parts() -> np.ndarray:
    """Number every part: which group it is in, whether it is ink, whether its
    inside is. Returns how heavy a line each number asks for."""
    parts = [obj for obj in bpy.data.objects if "fyre_group" in obj]
    groups = sorted({obj["fyre_group"] for obj in parts})
    heavy = np.zeros((len(groups) + 2) * 8, np.float32)
    for obj in parts:
        flags = (1 if obj["fyre_ink"] else 0) + (2 if obj["fyre_lined"] else 0) + (4 if obj["fyre_lined"] == "ink" else 0)
        obj.pass_index = (groups.index(obj["fyre_group"]) + 1) * 8 + flags
        heavy[obj.pass_index] = max(heavy[obj.pass_index], obj.get("fyre_line", 1.0))
    return heavy


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


# -- posing -----------------------------------------------------------------


def _rig() -> bpy.types.Object:
    return bpy.data.objects[RIG]


def _driven(rig: bpy.types.Object) -> list[str]:
    """The bones a pose sets: the controls, the palms and the fingers."""
    names = [*Rig.CONTROLS, "glass"]
    for tag in ("L", "R"):
        names += [f"aim.{tag}", f"back.{tag}", f"palm.{tag}"]
        names += [f"{bone}.{tag}" for bones in Rig.FINGERS.values() for bone in bones]
    return names


def state(name: str) -> State:
    """A pose from the library as numbers: for every bone a pose sets, where
    it moves to, how it turns (degrees) and its size. Two of these can be
    blended, which is how he moves from one pose to the next."""
    rig = _rig()
    spec = POSES[name]
    out: State = {}
    for bone in _driven(rig):
        out[f"{bone}:location"] = (0.0, 0.0, 0.0)
        out[f"{bone}:rotation_euler"] = (0.0, 0.0, 0.0)
    # He starts from how he stands, and a pose is laid over that: its moves
    # and turns add to the stance's, and what it puts `at` a place is there.
    for given in (STANCE, spec):
        for control, how in given.items():
            if control in ("hands", "glass") or control.startswith("palm."):
                continue
            rest = rig.data.bones[control].head_local
            if "at" in how:
                out[f"{control}:location"] = tuple(Vector(how["at"]) * UNIT - rest)
            if "move" in how:
                out[f"{control}:location"] = tuple(Vector(out[f"{control}:location"]) + Vector(how["move"]) * UNIT)
            if "turn" in how:
                out[f"{control}:rotation_euler"] = tuple(a + b for a, b in zip(out[f"{control}:rotation_euler"], how["turn"]))
    _wear_hat(out)

    # The glass is always in his hand. Unless the pose holds it, it is too small to see.
    out["glass:scale"] = (1.0,) * 3 if spec.get("glass") else (0.001,) * 3

    hands = {"L": "relaxed", "R": "relaxed", **STANCE.get("hands", {}), **spec.get("hands", {})}
    for side, tag in ((-1, "L"), (1, "R")):
        bones = rig.data.bones
        hand = bones[f"hand.{tag}"].head_local + Vector(out[f"hand.{tag}:location"])
        elbow = bones[f"elbow.{tag}"].head_local + Vector(out[f"elbow.{tag}:location"])
        palm = {**STANCE.get(f"palm.{tag}", {}), **spec.get(f"palm.{tag}", {})}
        # A hand's directions are his own and turn with him, unless the pose
        # gives them as they are seen in the picture.
        own = _turned(out).inverted() if palm.get("picture") else Matrix.Identity(3)
        aim = (own @ Vector(palm["aim"])).normalized() if "aim" in palm else (hand - elbow).normalized()
        # Left to itself the back of a hand faces outward and a little up.
        back = (own @ Vector(palm["back"])).normalized() if "back" in palm else Vector((side, -0.2, 0.35)).normalized()
        if back.cross(aim).length < 0.2:
            back = Vector((0.0, -0.3, 1.0)).normalized()
        for control, towards in (("aim", aim), ("back", back)):
            bone = bones[f"{control}.{tag}"]
            out[f"{control}.{tag}:location"] = tuple(towards * UNIT - (bone.head_local - bones[f"hand.{tag}"].head_local))
        shape = hands[tag]
        # In a pocket there is no hand: it shrinks away inside the coat.
        out[f"palm.{tag}:scale"] = (0.02,) * 3 if shape == "pocket" else (1.0,) * 3
        for finger, folds in HANDS["fist" if shape == "pocket" else shape].items():
            joints = Rig.FINGERS[finger]
            for index, joint in enumerate(joints):
                spread = folds[len(joints)] if index == 0 else 0.0
                # Folding is the same turn on both hands; spreading mirrors.
                out[f"{joint}.{tag}:rotation_euler"] = (-folds[index], 0.0, side * spread)
    return out


def _turned(values: State, bones: tuple[str, ...] = ("root", "body", "chest")) -> Matrix:
    """How a state turns his chest (or the last of `bones`) in the picture:
    his own directions to the picture's."""
    turn = Matrix.Identity(3)
    for bone in bones:
        turn = turn @ Euler([math.radians(v) for v in values[f"{bone}:rotation_euler"]], "XYZ").to_matrix()
    return turn


def _wear_hat(values: State) -> None:
    """Set the hat on his head as it is worn in the picture, whatever he is doing.

    Its slant is a slant in the picture, whichever way he faces. It does not
    nod towards us or away with him: leaning back must not show the whole
    underside of the brim, nor leaning in hide his lenses. Across the picture
    it takes up some of his lean. What the pose asks of the hat itself is
    his own, and comes on top.
    """
    head = _turned(values, ("root", "body", "chest", "head"))
    ahead, up = head @ Vector((0.0, -1.0, 0.0)), head @ Vector((0.0, 0.0, 1.0))
    facing = math.atan2(ahead.x, -ahead.y)
    across = math.atan2(up.x, up.z)
    nod, roll, turn = values["hat:rotation_euler"]
    slant = Euler((math.radians(-HAT_BACK), math.radians(-HAT_TILT) + HAT_LEAN * across, 0.0), "XYZ").to_matrix()
    own = Euler([math.radians(v) for v in (nod, roll, turn)], "XYZ").to_matrix()
    worn = head.inverted() @ slant @ Matrix.Rotation(facing, 3, "Z") @ own
    values["hat:rotation_euler"] = tuple(math.degrees(v) for v in worn.to_euler("XYZ"))
    # And the crown keeps its two peaks square to the camera.
    values["crown:rotation_euler"] = (0.0, 0.0, -math.degrees(facing) - turn)


def blend(a: State, b: State, t: float) -> State:
    return {key: tuple(x + (y - x) * t for x, y in zip(a[key], b[key])) for key in a}


def apply(values: State) -> None:
    """Put the rig where a state says."""
    rig = _rig()
    for key, value in values.items():
        bone, channel = key.split(":")
        if channel == "rotation_euler":
            value = tuple(math.radians(v) for v in value)
        if channel == "scale":
            # Easing overshoots; a size must not overshoot through nothing.
            value = tuple(max(v, 0.001) for v in value)
        setattr(rig.pose.bones[bone], channel, value)


@contextmanager
def posing() -> Iterator[None]:
    """While this holds, the rig stays where it is put. Otherwise the poses
    keyed on the timeline put it back the moment a picture is taken."""
    data = _rig().animation_data
    held = (data.action, getattr(data, "action_slot", None)) if data else None
    if data:
        data.action = None
    try:
        yield
    finally:
        if held and held[0] is not None:
            data.action = held[0]
            if held[1] is not None:
                data.action_slot = held[1]


def pose(name: str) -> None:
    """Put the rig in a pose from the library, the tie and the coat hanging at rest."""
    apply(state(name))
    Swings().step(settle=True)


def emotion(name: str) -> None:
    """Set the brows in the .blend. The studio sets its own, from the manifest."""
    rig = _rig()
    for side, tag, (roll, lift) in zip((-1, 1), ("L", "R"), EMOTIONS[name]):
        brow = rig.pose.bones[f"brow.{tag}"]
        # Looking along +Y, a positive turn is clockwise in the picture.
        brow.rotation_euler = (0.0, math.radians(side * roll), 0.0)
        brow.location = (0.0, 0.0, lift * UNIT)


def brows() -> dict[str, dict]:
    """Where the brows are in the picture as he stands: for each, its middle,
    and one unit along it and one unit up from it, in sprite pixels, and
    whether it is on the side of the hat that faces us."""
    rig = _rig()
    held = [(bone.location.copy(), bone.rotation_euler.copy()) for bone in (rig.pose.bones[f"brow.{tag}"] for tag in ("L", "R"))]
    for tag in ("L", "R"):
        rig.pose.bones[f"brow.{tag}"].location = (0.0, 0.0, 0.0)
        rig.pose.bones[f"brow.{tag}"].rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    out = {}
    for tag in ("L", "R"):
        frame = rig.matrix_world @ rig.pose.bones[f"brow.{tag}"].matrix
        middle = frame.translation / UNIT
        at = Vector(project(middle))
        along = Vector(project(middle + frame.col[0].xyz.normalized())) - at
        up = Vector(project(middle + frame.col[2].xyz.normalized())) - at
        # A brow on the far side of the hat is not drawn.
        eye = Vector((0.0, -DISTANCE, EYE))
        shown = (-frame.col[1].xyz.normalized()).dot((eye - middle).normalized()) > 0.15
        out[tag] = {"at": [round(v, 2) for v in at], "along": [round(v, 2) for v in along], "up": [round(v, 2) for v in up], "shown": shown}
    for tag, (location, rotation) in zip(("L", "R"), held):
        rig.pose.bones[f"brow.{tag}"].location = location
        rig.pose.bones[f"brow.{tag}"].rotation_euler = rotation
    return out


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
                if bone.name in Rig.SWINGS:
                    bone.keyframe_insert("rotation_quaternion", frame=frame)
                    bone.keyframe_insert("scale", frame=frame)
                elif bone.name in _driven(rig) or bone.name.startswith("brow."):
                    for channel in ("location", "rotation_euler", "scale"):
                        bone.keyframe_insert(channel, frame=frame)
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
    """The part map of the scene as it stands: rows × columns × 4, bottom row first."""
    # One file to a process: two Blenders drawing at once must not read each other's.
    path = Path(tempfile.gettempdir()) / f"mrfyre-parts-{os.getpid()}.exr"
    scene.render.filepath = str(path)
    layer = bpy.context.view_layer
    layer.material_override = bpy.data.materials.get(CODE) or _code()
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        layer.material_override = None
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


def _strokes(mask: np.ndarray, least: int) -> np.ndarray:
    """A mask without its specks: only the runs of touching pixels at least `least` long."""
    out = np.zeros_like(mask)
    left = set(zip(*np.nonzero(mask)))
    while left:
        start = left.pop()
        run, edge = [start], [start]
        while edge:
            row, column = edge.pop()
            for near in ((row + r, column + c) for r in (-1, 0, 1) for c in (-1, 0, 1)):
                if near in left:
                    left.remove(near)
                    run.append(near)
                    edge.append(near)
        rows, columns = zip(*run)
        if max(max(rows) - min(rows), max(columns) - min(columns)) >= least:
            out[list(rows), list(columns)] = True
    return out


def _drawing(parts: np.ndarray, heavy: np.ndarray) -> np.ndarray:
    """A part map turned into the picture: white paper, black ink, and a line
    as heavy as the part it goes round asks (`heavy`, by the part's number)."""
    full = parts.shape[:2]
    per_unit = full[0] / (CANVAS[3] - CANVAS[1])
    # Only the part of the canvas he is in needs working out.
    rows, columns = np.nonzero((parts[..., 3] > 0.5).any(axis=1))[0], np.nonzero((parts[..., 3] > 0.5).any(axis=0))[0]
    if not len(rows):
        return np.zeros((full[0] // OVERSAMPLE, full[1] // OVERSAMPLE, 4), np.float32)
    margin = round(LINE * float(heavy.max()) * per_unit) + OVERSAMPLE
    low = [max(0, (int(v[0]) - margin) // OVERSAMPLE * OVERSAMPLE) for v in (rows, columns)]
    high = [min(size, -(-(int(v[-1]) + margin) // OVERSAMPLE) * OVERSAMPLE) for v, size in zip((rows, columns), full)]
    parts = parts[low[0] : high[0], low[1] : high[1]]
    there = parts[..., 3] > 0.5
    code = np.rint(parts[..., 0]).astype(np.int32)
    code[~there] = 0
    # The inside of lined cloth is a shape of its own, and may be ink.
    inside = ((code & 2) > 0) & (parts[..., 2] > 0.5)
    ink = there & (((code & 1) > 0) | (((code & 4) > 0) & inside))
    shape = (code >> 3) * 4 + inside * 2 + ink
    shape[~there] = -1
    depth = parts[..., 1]
    weight = heavy[code]
    # How heavy a line each pixel is on: none, to begin with.
    edge = np.zeros(there.shape, np.float32)
    fold = np.zeros(there.shape, np.float32)
    up = (slice(None, -1), slice(None)), (slice(1, None), slice(None))
    across = (slice(None), slice(None, -1)), (slice(None), slice(1, None))
    for one, other in (up, across):
        # A border is where a pixel and its neighbour are different things. It
        # is drawn as heavily as the heavier of the two asks.
        border = shape[one] != shape[other]
        between = np.where(border, np.maximum(weight[one], weight[other]), 0.0)
        edge[one] = np.maximum(edge[one], between)
        edge[other] = np.maximum(edge[other], between)
        # A fold is where they are the same thing at two distances.
        crossing = np.where(~border & there[one] & (np.abs(depth[one] - depth[other]) > EDGE), weight[one] * FOLD, 0.0)
        fold[one] = np.maximum(fold[one], crossing)
        fold[other] = np.maximum(fold[other], crossing)
    fold[~_strokes(fold > 0, round(SPECK * per_unit))] = 0.0
    edge = np.maximum(edge, fold)
    lines = np.zeros_like(there)
    for level in np.unique(edge[edge > 0]):
        lines |= _thicken(edge == level, max(round(LINE * float(level) / 2 * per_unit) - 1, 0))
    white = there & ~ink & ~lines
    solid = there | lines

    def averaged(mask: np.ndarray) -> np.ndarray:
        rows, columns = mask.shape[0] // OVERSAMPLE, mask.shape[1] // OVERSAMPLE
        return mask.reshape(rows, OVERSAMPLE, columns, OVERSAMPLE).mean(axis=(1, 3), dtype=np.float32)

    alpha = averaged(solid)
    value = np.divide(averaged(white), alpha, out=np.zeros_like(alpha), where=alpha > 0)
    picture = np.zeros((full[0] // OVERSAMPLE, full[1] // OVERSAMPLE, 4), np.float32)
    picture[low[0] // OVERSAMPLE : high[0] // OVERSAMPLE, low[1] // OVERSAMPLE : high[1] // OVERSAMPLE] = np.stack(
        [value, value, value, alpha], axis=-1
    )
    return picture


def _save(picture: np.ndarray, path: Path) -> None:
    height, width, _ = picture.shape
    image = bpy.data.images.new("mrfyre-sprite", width, height, alpha=True)
    image.pixels.foreach_set(picture.ravel())
    path.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def draw(path: Path) -> None:
    """Draw him as he stands, without his brows, to a transparent PNG."""
    scene = bpy.context.scene
    hidden = bpy.data.collections[BROWS].hide_render
    bpy.data.collections[BROWS].hide_render = True
    try:
        _save(_drawing(_parts(scene), _code_parts()), path)
    finally:
        bpy.data.collections[BROWS].hide_render = hidden


def manifest(extra: dict | None = None) -> dict:
    """What the studio needs to place a sprite and to draw the brows on it."""
    width, height = _size(1.0)
    slab = [[v.x / UNIT, v.z / UNIT] for v in _brow_slab()]
    return {
        "pixelsPerUnit": PIXELS_PER_UNIT,
        "width": width,
        "height": height,
        # The point on the ground he stands over.
        "origin": [round(-CANVAS[0] * PIXELS_PER_UNIT), round(project(Vector((0, 0, 0)))[1])],
        # Ground to the tips of the hat, standing.
        "standing": 10.8,
        # A brow's corners, along it and up from it, for the brow on screen
        # right; the other is its mirror image.
        "brow": [[round(x, 4), round(z, 4)] for x, z in slab],
        "emotions": {name: [list(left), list(right)] for name, (left, right) in EMOTIONS.items()},
        **(extra or {}),
    }


def _brow_slab() -> list[Vector]:
    """The corners of the screen-right brow, in its bone's own axes."""
    brow = bpy.data.objects["brow.R"]
    frame = _rig().data.bones["brow.R"].matrix_local.inverted()
    return [frame @ vertex.co for vertex in brow.data.vertices]


def prepare(scale: float = 1.0) -> None:
    """Set the scene up for `draw`."""
    _code_parts()
    _code()
    _settings(bpy.context.scene, scale)


def render(out: Path, scale: float = 1.0, only: set[str] | None = None) -> int:
    """Draw every pose as a transparent sprite, `body/<pose>.png` under `out`,
    and write down where the brows go on each."""
    prepare(scale)
    poses: dict[str, dict] = {}
    try:
        with posing():
            for name in POSES:
                if only and name not in only:
                    continue
                pose(name)
                poses[name] = {"brows": brows()}
                draw(out / "body" / f"{name}.png")
    finally:
        prepare()
        bpy.context.scene.frame_set(frame_of(0))
    listed = out / "manifest.json"
    if only and listed.exists():
        # A few poses redrawn: the rest stay as they were listed.
        poses = {**json.loads(listed.read_text()).get("poses", {}), **poses}
    listed.write_text(json.dumps(manifest({"poses": poses}), indent=2) + "\n")
    return len(poses)

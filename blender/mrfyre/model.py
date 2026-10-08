"""Mr. Fyre as a 3D model that is drawn, not lit.

He is an ordinary model: round head, a hat with a brim and a crown, one coat
with its collar turned up, sleeves, hands with fingers. `scene.py` never
lights him. It asks which part is in front at every pixel and how far away it
is, fills paper white and ink black, and draws one weight of line wherever
two parts meet or one thing passes in front of another.

Parts that share a `group` are one shape to that line. The coat and its
sleeves are one group, so there is no line round the shoulder where the
sleeve leaves the coat, only where the arm crosses in front of the body.

Units throughout are character units: the ground is z = 0, the tips of the hat
z = 10.8, he faces -Y, x is screen right. "L" is the side on screen left.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

# Blender units per character unit: he stands a little over 2 m tall.
UNIT = 0.2

COLLECTION = "MrFyre"
BROWS = "MrFyre.brows"
RIG = "MrFyre.rig"

HEAD = Vector((0.0, 0.0, 8.2))
HEAD_R = 1.2
# The lenses: how far either side of the middle, how far in front of the
# middle of the head, how far above it, and how big.
LENS_X, LENS_Y, LENS_Z, LENS_R = 0.49, 1.2, 0.3, 0.41

# The hat. The brim is a cone; the crown is wide where it leaves the brim and
# narrows to a ridge with a notch in it, which makes the two peaks. The brim
# is steep enough that the lenses, which stand off the face, fit under it.
BRIM_Z, BRIM_R = 8.44, 1.95
CROWN_Z, CROWN_R = 9.15, 1.12
PEAK_Z, PEAK_X, NOTCH_Z = 10.8, 0.37, 10.12
# Where a brow hangs in front of the hat: how far from the middle, how far in
# front of it, how far above the edge of the brim.
BROW_X, BROW_Y, BROW_Z = 0.52, 1.6, 0.27

# Shirt and trousers: how much thinner he is front to back than side to side.
BODY_DEPTH = 0.74

# The toon hand's mesh units to character units.
HAND_SCALE = 0.112
# How much heavier the coat's line is than the rest of him.
COAT_LINE = 1.5
# The magnifying glass, across its ring.
GLASS_R = 0.66

Verts = list[tuple[float, float, float]]
Faces = list[tuple[int, ...]]
Shape = tuple[Verts, Faces]


# -- shapes -----------------------------------------------------------------


def lathe(
    profile: list[tuple[float, float]],
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 48,
    depth: float = 1.0,
) -> Shape:
    """`profile` — (radius, height) pairs — spun round the vertical axis.

    `depth` squashes it front to back. A profile that runs upward faces out.
    """
    verts: Verts = []
    for radius, height in profile:
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            verts.append(
                (center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle) * depth, center[2] + height)
            )
    faces: Faces = []
    for ring in range(len(profile) - 1):
        for i in range(segments):
            a, b = ring * segments + i, ring * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    return verts, faces


def spline(points: list[tuple[float, ...]], steps: int = 6) -> list[tuple[float, ...]]:
    """A smooth curve through the points given, whatever they are tuples of."""
    spots = [Vector(p) for p in points]
    padded = [spots[0] * 2 - spots[1], *spots, spots[-1] * 2 - spots[-2]]
    out: list[tuple[float, ...]] = []
    for i in range(1, len(spots)):
        p0, p1, p2, p3 = padded[i - 1 : i + 3]
        for k in range(steps):
            t = k / steps
            out.append(tuple(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t**3)))
    out.append(tuple(points[-1]))
    return out


def ball(center: tuple[float, float, float] | Vector, rx: float, ry: float, rz: float, segments: int = 32) -> Shape:
    rings = segments // 2
    profile = [(math.sin(math.pi * i / rings), -math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    verts, faces = lathe(profile, segments=segments)
    return [(center[0] + x * rx, center[1] + y * ry, center[2] + z * rz) for x, y, z in verts], faces


def skin(rings: list[list[Vector]], closed: bool = True) -> Shape:
    """A surface stretched over a stack of rings that all have the same number of points."""
    count = len(rings[0])
    verts: Verts = [tuple(point) for ring in rings for point in ring]
    faces: Faces = []
    for ring in range(len(rings) - 1):
        for i in range(count if closed else count - 1):
            a, b = ring * count + i, ring * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    return verts, faces


def tube(points: list[Vector], radii: list[float], segments: int = 24, caps: bool = True) -> Shape:
    """A round limb through `points`, `radii[i]` thick at each."""
    rings: list[list[Vector]] = []
    for i, point in enumerate(points):
        ahead = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        side = ahead.cross(Vector((0.0, 1.0, 0.0))).normalized()
        front = side.cross(ahead)
        rings.append(
            [point + (side * math.cos(a) + front * math.sin(a)) * radii[i] for a in (2 * math.pi * k / segments for k in range(segments))]
        )
    verts, faces = skin(rings)
    if caps:
        faces.append(tuple(range(segments)))
        faces.append(tuple(range((len(points) - 1) * segments, len(points) * segments)))
    return verts, faces


def patch(origin: Vector, radius: float, aim: Vector, size: float, rings: int = 6, segments: int = 40) -> Shape:
    """A round patch of a sphere's surface, `size` across its radius, facing `aim`."""
    aim = aim.normalized()
    side = aim.cross(Vector((0.0, 0.0, 1.0))).normalized()
    up = side.cross(aim)
    verts: Verts = [tuple(origin + aim * radius)]
    for ring in range(1, rings + 1):
        angle = size * ring / rings / radius
        for k in range(segments):
            turn = 2 * math.pi * k / segments
            spoke = side * math.cos(turn) + up * math.sin(turn)
            verts.append(tuple(origin + (aim * math.cos(angle) + spoke * math.sin(angle)) * radius))
    faces: Faces = [(0, 1 + k, 1 + (k + 1) % segments) for k in range(segments)]
    for ring in range(rings - 1):
        for k in range(segments):
            a, b = 1 + ring * segments + k, 1 + ring * segments + (k + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    return verts, faces


def plate(points: list[tuple[float, float, float]] | list[Vector]) -> Shape:
    """A flat cut-out."""
    return [tuple(p) for p in points], [tuple(range(len(points)))]


def joined(*shapes: Shape) -> Shape:
    verts: Verts = []
    faces: Faces = []
    for shape_verts, shape_faces in shapes:
        offset = len(verts)
        verts += shape_verts
        faces += [tuple(i + offset for i in face) for face in shape_faces]
    return verts, faces


def bent(start: Vector, joint: Vector, end: Vector, steps: int = 16) -> list[Vector]:
    """A curve from `start` to `end` that leans towards `joint` without making a corner there."""
    return [
        start * (1 - t) ** 2 + joint * 2 * t * (1 - t) + end * t * t
        for t in (i / steps for i in range(steps + 1))
    ]


def jointed(points: list[Vector], segments: int = 24) -> list[float]:
    """How much each vertex of a limb follows its second bone: the first third
    follows the first, the last third the second, and the joint bends between."""
    weights = []
    for i in range(len(points)):
        t = min(1.0, max(0.0, (i / (len(points) - 1) - 0.36) / 0.28))
        weights += [t * t * (3 - 2 * t)] * segments
    return weights


def ramp(value: float, low: float, high: float) -> float:
    """0 at `low`, 1 at `high`, eased between."""
    t = min(1.0, max(0.0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


# -- the model --------------------------------------------------------------


class Model:
    """Builds the meshes and the rig into the open .blend, replacing any earlier build."""

    def __init__(self) -> None:
        for name in (COLLECTION, BROWS):
            old = bpy.data.collections.get(name)
            if old is not None:
                for obj in list(old.objects):
                    bpy.data.objects.remove(obj)
                bpy.data.collections.remove(old)
        self.collection = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(self.collection)
        # Beside the body, not inside it: the brows are never in the picture
        # Blender takes. The studio draws them, from where the rig puts them.
        self.brows = bpy.data.collections.new(BROWS)
        bpy.context.scene.collection.children.link(self.brows)
        self.paper = self._material("Fyre paper", (1.0, 1.0, 1.0))
        self.ink = self._material("Fyre ink", (0.0, 0.0, 0.0))
        self.rig = Rig(self.collection)
        self._head()
        self._hat()
        self._body()
        self._coat()
        for side, tag in ((-1, "L"), (1, "R")):
            self._arm(side, tag)
            self._hand(side, tag)
            self._leg(side, tag)
        self._glass()

    @staticmethod
    def _material(name: str, color: tuple[float, float, float]) -> bpy.types.Material:
        """Only for looking at him in the viewport; the drawing does not use materials."""
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.diffuse_color = (*color, 1.0)
        return material

    def part(
        self,
        name: str,
        shape: Shape,
        *,
        bone: str | None = None,
        weights: dict[str, list[float]] | None = None,
        ink: bool = False,
        lined: str | None = None,
        group: str | None = None,
        line: float = 1.0,
        smooth: int = 0,
        thick: float = 0.0,
        collection: bpy.types.Collection | None = None,
    ) -> bpy.types.Object:
        """One piece of him: paper (white, outlined) unless `ink` (black).

        `bone` carries it rigidly; `weights` (per vertex, per bone) bend it
        instead. Pieces with the same `group` are outlined as one shape, and
        `line` is how heavy that outline is, 1 being the ordinary weight.
        `lined` cloth has an inside, which is a shape of its own, "paper" or
        "ink".

        `smooth` rounds it that many times, keeping the corners of an open
        piece sharp; `thick` then gives it that much thickness. Together they
        are how cloth is made here: a few flat faces laid where the piece
        goes, rounded, then thickened.
        """
        verts, faces = shape
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(c * UNIT for c in v) for v in verts], [], faces)
        scratch = bmesh.new()
        scratch.from_mesh(mesh)
        if weights is None:
            bmesh.ops.remove_doubles(scratch, verts=scratch.verts, dist=1e-6)
        # Every face the same way round, and that way out: the inside of the
        # coat is told from its outside by which way a face points.
        bmesh.ops.recalc_face_normals(scratch, faces=scratch.faces)
        middle = sum((v.co for v in scratch.verts), Vector()) / len(scratch.verts)
        outward = sum((f.calc_center_median() - middle).dot(f.normal) * f.calc_area() for f in scratch.faces)
        area = sum(f.calc_area() for f in scratch.faces)
        if abs(outward) < 0.05 * area * max((v.co - middle).length for v in scratch.verts):
            # A flat patch has no inside of its own: out is away from the
            # middle of him.
            outward = sum(Vector((*f.calc_center_median().xy, 0.0)).dot(f.normal) * f.calc_area() for f in scratch.faces)
        if outward < 0:
            bmesh.ops.reverse_faces(scratch, faces=scratch.faces)
        scratch.to_mesh(mesh)
        scratch.free()
        mesh.materials.append(self.ink if ink else self.paper)
        obj = bpy.data.objects.new(name, mesh)
        obj["fyre_group"] = group or name
        obj["fyre_ink"] = ink
        obj["fyre_lined"] = lined or ""
        obj["fyre_line"] = line
        (collection or self.collection).objects.link(obj)
        if bone is not None:
            self.rig.carry(obj, bone)
        if weights is not None:
            for bone_name, values in weights.items():
                vertex_group = obj.vertex_groups.new(name=bone_name)
                for index, value in enumerate(values):
                    if value > 0:
                        vertex_group.add([index], value, "REPLACE")
            obj.modifiers.new("Rig", "ARMATURE").object = self.rig.obj
        if smooth:
            rounding = obj.modifiers.new("Round", "SUBSURF")
            rounding.levels = rounding.render_levels = smooth
            rounding.boundary_smooth = "PRESERVE_CORNERS"
        if thick:
            cloth = obj.modifiers.new("Thick", "SOLIDIFY")
            cloth.thickness = thick * UNIT
            # Outward: what was laid on him stays where it was laid.
            cloth.offset = 1.0
            cloth.use_even_offset = True
        return obj

    # -- head and hat --

    def _head(self) -> None:
        # A plain ball. Its top fits inside the crown, and shows when the hat
        # jumps off it.
        self.part("head", ball(HEAD, HEAD_R, HEAD_R, HEAD_R, 48), bone="head")
        for side, tag in ((-1, "L"), (1, "R")):
            # A lens is a flat white disc that stands clear of the face, the
            # way a lens of a pair of glasses does: it does not bend round his
            # head, and when he turns it shows past the edge of it. No frame,
            # no bridge, no eye behind it. The brim always covers its top.
            disc = [
                (side * LENS_X + LENS_R * math.cos(a), HEAD.y - LENS_Y, HEAD.z + LENS_Z + LENS_R * math.sin(a))
                for a in (2 * math.pi * i / 48 for i in range(48))
            ]
            self.part(f"lens.{tag}", plate(disc), bone="head")
        # The mouth is one short thin stroke, a little off to one side. It is
        # level, its ends if anything a touch down: he does not smile.
        skin_r = HEAD_R + 0.015
        top, bottom = [], []
        for i in range(9):
            t = i / 4 - 1
            x, z = 0.17 + 0.22 * t, -0.74 - 0.006 * t * t
            thick = 0.022 * (1 - 0.5 * t * t)
            for row, at in ((top, z + thick), (bottom, z - thick)):
                row.append(HEAD + Vector((x, -math.sqrt(skin_r**2 - x * x - at * at), at)))
        self.part("mouth", skin([top, bottom], closed=False), bone="head", ink=True, line=0.55)

    def _hat(self) -> None:
        count = 64
        # A cone seen from the front is a wedge with pointed tips. It is one
        # skin, ink underneath: seen from a little below, the far side of the
        # brim shows as the dark slivers either side of his head.
        # It runs on a little way inside the crown, and the crown a little way
        # down inside it, so that turning one in the other opens no gap.
        brim = lathe([(BRIM_R, BRIM_Z), (CROWN_R, CROWN_Z), (CROWN_R - 0.2, CROWN_Z + 0.13)], segments=count)
        self.part("hat.brim", brim, bone="hat", group="hat", lined="ink", line=1.2)

        # The crown: round where it stands on the brim, closing to a narrow
        # ridge that runs side to side. The ridge dips in the middle.
        ridge = PEAK_X / math.cos(2 * math.pi * 4 / count)
        fall = (PEAK_Z - CROWN_Z) / (CROWN_R - PEAK_X)

        def top(x: float) -> float:
            if abs(x) <= PEAK_X:
                return NOTCH_Z + (PEAK_Z - NOTCH_Z) * abs(x) / PEAK_X
            return PEAK_Z - (abs(x) - PEAK_X) * fall

        rings: list[list[Vector]] = []
        for t in (-0.09, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
            ring = []
            for i in range(count):
                angle = 2 * math.pi * i / count
                foot = Vector((CROWN_R * math.cos(angle), CROWN_R * math.sin(angle), CROWN_Z))
                x = ridge * math.cos(angle)
                ring.append(foot.lerp(Vector((x, 0.1 * math.sin(angle), top(x))), t))
            rings.append(ring)
        verts, faces = skin(rings)
        last = (len(rings) - 1) * count
        for i in range(count // 2):
            # Close the ridge: join each point on its front to the one behind it.
            loop = dict.fromkeys(last + k % count for k in (i, i + 1, count - i - 1, count - i))
            faces.append(tuple(loop))
        # The crown has a bone of its own. A hat with two peaks has them from
        # wherever it is drawn, so `scene.py` keeps the ridge square to the
        # camera however he turns. The brim is round and shows nothing of it.
        self.part("hat.crown", (verts, faces), bone="crown", group="hat", line=1.2)

        for side, tag in ((-1, "L"), (1, "R")):
            # A brow is a slab cut on the slant: straight edges, sharp corners.
            # It is not on the hat. It hangs flat in the air in front of it,
            # square to us, and goes where the hat goes.
            middle = self.rig.rest[f"brow.{tag}"]
            slab = [(-0.33, -0.065), (-0.24, 0.065), (0.33, 0.065), (0.24, -0.065)]
            corners = [middle + Vector((side * x, 0.0, z)) for x, z in slab]
            self.part(f"brow.{tag}", plate(corners), bone=f"brow.{tag}", ink=True, collection=self.brows)

    # -- shirt, tie, trousers --

    def _body(self) -> None:
        shirt = [(0.97, 3.9), (0.97, 4.5), (0.97, 5.1), (0.97, 5.7), (0.97, 6.2), (0.86, 6.75), (0.58, 7.1), (0.0, 7.22)]
        verts, faces = lathe(shirt, depth=BODY_DEPTH)
        self.part("shirt", (verts, faces), weights=self._spine(verts))
        # The belt is a white band between two lines.
        belt = [(0.97, 3.7), (1.0, 3.73), (1.0, 3.97), (0.97, 4.0)]
        self.part("belt", lathe(belt, depth=BODY_DEPTH + 0.01), bone="body", line=0.8)
        seat = [(0.0, 2.8), (0.62, 2.92), (0.94, 3.25), (0.98, 3.72)]
        self.part("seat", lathe(seat, depth=BODY_DEPTH), bone="body", group="trousers")

        # The tie hangs just clear of the shirt and bends at three bones, so
        # that it can swing.
        y = -BODY_DEPTH - 0.08
        rows = [(6.98, 0.2), (6.6, 0.11), (6.2, 0.13), (5.75, 0.16), (5.3, 0.2), (4.85, 0.235), (4.45, 0.26), (3.9, 0.0)]
        verts: Verts = []
        for z, half in rows[:-1]:
            verts += [(-half, y, z), (half, y, z)]
        verts.append((0.02, y, rows[-1][0]))
        faces: Faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(rows) - 2)]
        faces.append((len(verts) - 3, len(verts) - 2, len(verts) - 1))
        joints = [self.rig.rest[f"tie.{i}"].z for i in (1, 2, 3)]
        weights: dict[str, list[float]] = {"tie.1": [], "tie.2": [], "tie.3": []}
        for _, _, z in verts:
            second, third = ramp(joints[1] + 0.25 - z, 0.0, 0.5), ramp(joints[2] + 0.25 - z, 0.0, 0.5)
            weights["tie.1"].append(1 - second)
            weights["tie.2"].append(second - third)
            weights["tie.3"].append(third)
        self.part("tie", (verts, faces), weights=weights, ink=True)

    # His back is not a rod: below here he follows his hips, above here his chest.
    SPINE = (4.4, 5.9)

    def _spine(self, verts: Verts, share: list[float] | None = None) -> dict[str, list[float]]:
        """How much of each vertex's `share` (all of it, if none is given)
        goes with the chest rather than the hips."""
        share = share or [1.0] * len(verts)
        chest = [ramp(z, *self.SPINE) * part for (_, _, z), part in zip(verts, share)]
        return {"body": [part - high for part, high in zip(share, chest)], "chest": chest}

    # -- the coat --

    # The coat at each height, hem to the foot of the collar:
    # (height, half its width, half its depth, half the opening down the front).
    # It is narrow in the chest, so that the arms hang outside it, and flares
    # below the hands. The neck is as wide as his head: he stands in the
    # collar like an egg in a cup.
    COAT = spline(
        [
            (1.7, 1.94, 1.44, 0.5),
            (2.6, 1.8, 1.34, 0.49),
            (3.4, 1.6, 1.22, 0.47),
            (4.1, 1.4, 1.1, 0.45),
            (4.8, 1.26, 1.0, 0.43),
            (5.6, 1.2, 0.95, 0.4),
            (6.4, 1.18, 0.93, 0.36),
            (6.85, 1.21, 0.95, 0.31),
            (7.2, 1.25, 1.0, 0.26),
        ],
        steps=4,
    )
    COAT_COLUMNS = 80
    # Cloth does not hang in a perfect round: towards the hem it falls into
    # this many soft folds, this deep.
    FOLDS = (5, 0.03)

    def _coat(self) -> None:
        verts, faces = skin([self._coat_ring(*station) for station in self.COAT], closed=False)
        self.part("coat", (verts, faces), weights=self._swing(verts), group="coat", lined="paper", line=COAT_LINE)
        self._collar()
        for side, tag in ((-1, "L"), (1, "R")):
            self._lapel(side, tag)

    # The collar is a band of cloth round his neck, turned up. It is low at
    # the throat, where its two ends stand either side of the knot of his tie,
    # and climbs to the back of his head, leaning out as it rises. Seen from
    # the front its rim comes down from a point beside each cheek to his
    # chest, and from the side it runs down from behind his head to under his
    # chin, leaving his face clear. Round from the front, in degrees: (where,
    # its foot, its rim).
    COLLAR = [(15, 6.62, 7.25), (38, 6.9, 7.42), (64, 7.05, 7.58), (92, 7.1, 7.72), (125, 7.1, 7.88), (155, 7.1, 7.98), (180, 7.1, 8.0)]

    def _collar(self) -> None:
        columns = self.COLLAR + [(360 - degrees, low, high) for degrees, low, high in reversed(self.COLLAR[:-1])]
        foot, waist, rim = [], [], []
        for degrees, low, high in columns:
            angle = math.radians(degrees)
            # No collar stands the same on both sides: on screen left it is a
            # little taller and straighter, on screen right it has flopped out.
            uneven = math.sin(angle)
            high -= 0.1 * uneven
            lean = 1.15 + 0.045 * uneven
            _, wide, deep, _ = self._coat_at(low)
            # Its foot is a little way down the outside of the coat, so that
            # no gap opens between them.
            below = Vector(((wide + 0.04) * math.sin(angle), -(deep + 0.04) * math.cos(angle), low))
            # Its ends stand forward, clear of his throat.
            above = Vector((wide * lean * math.sin(angle), -deep * lean * math.cos(angle) - 0.1 * max(0.0, math.cos(angle)), high))
            foot.append(below)
            # Up first, then out: a collar, not a funnel.
            waist.append(Vector((*below.xy.lerp(above.xy, 0.3), (low + high) / 2)))
            rim.append(above)
        self.part("collar", skin([foot, waist, rim], closed=False), bone="chest", group="coat", line=COAT_LINE, smooth=2, thick=0.06)

    def _lapel(self, side: int, tag: str) -> None:
        """A lapel is a pointed flap folded back from the front edge, below the
        end of the collar: three flat faces laid on the coat, rounded and
        given the thickness of cloth."""
        # Out from the front edge, and how high: its top, its point, its foot.
        top, point, low = Vector((0.0, 6.6)), Vector((0.56, 6.02)), Vector((0.0, 5.1))
        middle = (top + point + low) / 3
        flat = [top, (top + point) / 2, point, (point + low) / 2, low, (low + top) / 2, middle]
        verts = [tuple(self._on_coat(side, max(spot.x, 0.0), spot.y, 0.03)) for spot in flat]
        self.part(f"lapel.{tag}", (verts, [(0, 1, 6, 5), (2, 3, 6, 1), (4, 5, 6, 3)]), bone="chest", line=1.2, smooth=2, thick=0.07)

    def _coat_ring(self, z: float, wide: float, deep: float, gap: float) -> list[Vector]:
        """The coat at one height: from the front edge on screen right, round the back, to the other."""
        start = math.asin(gap / wide)
        hang = ramp(self.SWING_FROM - z, 0.0, self.SWING_FROM - 1.7) ** 2
        ring = []
        for i in range(self.COAT_COLUMNS + 1):
            angle = start + (2 * math.pi - 2 * start) * i / self.COAT_COLUMNS
            fold = 1 + self.FOLDS[1] * hang * math.cos(self.FOLDS[0] * angle + 0.5)
            ring.append(Vector((wide * fold * math.sin(angle), -deep * fold * math.cos(angle), z)))
        return ring

    def _coat_at(self, z: float) -> tuple[float, float, float, float]:
        for low, high in zip(self.COAT, self.COAT[1:]):
            if low[0] <= z <= high[0]:
                t = (z - low[0]) / (high[0] - low[0])
                return tuple(a + (b - a) * t for a, b in zip(low, high))
        return self.COAT[-1]

    def _on_coat(self, side: int, out: float, z: float, lift: float) -> Vector:
        """The point on the coat `out` from a front edge at height `z`, `lift` off the cloth."""
        _, wide, deep, gap = self._coat_at(z)
        angle = math.asin(min((gap + out) / wide, 1.0))
        normal = Vector((math.sin(angle) / wide, -math.cos(angle) / deep, 0.0)).normalized()
        spot = Vector((wide * math.sin(angle), -deep * math.cos(angle), z)) + normal * lift
        return Vector((side * spot.x, spot.y, spot.z))

    # Where the coat swings from, and which way round each of its five
    # controls is: the two front panels, the two sides and the back.
    SWING_FROM = 5.3
    SWING = {"coat.FR": 32.0, "coat.R": 100.0, "coat.B": 180.0, "coat.L": 260.0, "coat.FL": 328.0}

    def _swing(self, verts: Verts) -> dict[str, list[float]]:
        """The lower the cloth, the more the control nearest it moves it."""
        names, angles = list(self.SWING), list(self.SWING.values())
        weights: dict[str, list[float]] = {"body": [], **{name: [] for name in names}}
        for x, y, z in verts:
            hang = ramp(self.SWING_FROM - z, 0.0, self.SWING_FROM - 1.7) ** 1.3
            angle = math.degrees(math.atan2(x, -y)) % 360
            share = dict.fromkeys(names, 0.0)
            if angle <= angles[0]:
                share[names[0]] = 1.0
            elif angle >= angles[-1]:
                share[names[-1]] = 1.0
            else:
                for i in range(len(angles) - 1):
                    if angles[i] <= angle <= angles[i + 1]:
                        t = ramp(angle, angles[i], angles[i + 1])
                        share[names[i]], share[names[i + 1]] = 1 - t, t
            for name in names:
                weights[name].append(hang * share[name])
            weights["body"].append(1 - hang)
        return {**weights, **self._spine(verts, weights["body"])}

    # -- arms and hands --

    def _arm(self, side: int, tag: str) -> None:
        rig = self.rig
        shoulder, elbow, hand = rig.rest[f"shoulder.{tag}"], rig.rest[f"elbow.{tag}"], rig.rest[f"hand.{tag}"]
        points = bent(shoulder, elbow, hand + (hand - elbow).normalized() * 0.2)
        # Wide all the way down and a little wider at the cuff, which is
        # open: the sleeve comes down over the heel of the hand, and the hand
        # comes out of it. The shoulder is a ball, so the sleeve leaves the
        # coat rounded.
        radii = [0.54 - 0.06 * t + 0.05 * ramp(t, 0.8, 1.0) for t in (i / (len(points) - 1) for i in range(len(points)))]
        lower = jointed(points)
        sleeve = tube(points, radii, caps=False)
        cap = ball(shoulder, radii[0], radii[0], radii[0], 24)
        verts, faces = joined(sleeve, cap)
        weights = {
            f"upper.{tag}": [1 - w for w in lower] + [1.0] * len(cap[0]),
            f"lower.{tag}": lower + [0.0] * len(cap[0]),
        }
        self.part(f"sleeve.{tag}", (verts, faces), weights=weights, group="coat", line=COAT_LINE)

    def _hand(self, side: int, tag: str) -> None:
        """The toon hand (see `toon_hand.json`), without its glove cuff, on the rig's finger bones."""
        data = Rig.hand_data()
        keep = [i for i, v in enumerate(data["verts"]) if v[1] > Rig.HAND_CUT]
        index = {old: new for new, old in enumerate(keep)}
        verts = [tuple(self.rig.hand_point(tag, data["verts"][i])) for i in keep]
        faces = [tuple(index[i] for i in face) for face in data["faces"] if all(i in index for i in face)]
        # Cutting the cuff off left the heel of the hand open. Close it over:
        # it is a rounded end that goes up the sleeve.
        edges: dict[tuple[int, int], int] = {}
        for face in faces:
            for a, b in zip(face, face[1:] + face[:1]):
                edges[min(a, b), max(a, b)] = edges.get((min(a, b), max(a, b)), 0) + 1
        rim = [edge for edge, used in edges.items() if used == 1]
        around = sorted({i for edge in rim for i in edge})
        heel = sum((Vector(verts[i]) for i in around), Vector()) / len(around)
        back = (self.rig.rest[f"elbow.{tag}"] - self.rig.rest[f"hand.{tag}"]).normalized()
        verts.append(tuple(heel + back * 0.12))
        faces += [(a, b, len(verts) - 1) for a, b in rim]
        weights: dict[str, list[float]] = {f"palm.{tag}": [0.0] * (len(verts) - 1) + [1.0]}
        for new, old in enumerate(keep):
            given = data["weights"][old] or {"Hand": 1.0}
            for bone, value in given.items():
                name = f"palm.{tag}" if bone == "Hand" else f"{bone}.{tag}"
                weights.setdefault(name, [0.0] * len(verts))[new] = value
        self.part(f"hand.{tag}", (verts, faces), weights=weights, smooth=2)

    def _glass(self) -> None:
        """His magnifying glass: a ring with nothing in it, so that whatever is
        behind shows through, on a handle that lies across the fist. It is
        in his hand in every pose, shrunk to nothing inside the palm in all
        but the ones that hold it."""
        grip, out, face = self.rig.glass()
        stem = tube([grip - out * 0.3, grip + out * 0.82], [0.085, 0.085], segments=16)
        middle = grip + out * (0.82 + GLASS_R)
        round_it = out.cross(face)
        hoop = []
        for i in range(49):
            angle = 2 * math.pi * i / 48
            spoke = out * math.cos(angle) + round_it * math.sin(angle)
            hoop.append([middle + spoke * (GLASS_R + 0.08 * math.cos(b)) + face * 0.08 * math.sin(b) for b in (2 * math.pi * k / 10 for k in range(10))])
        self.part("glass", joined(stem, skin(hoop)), bone="glass")

    # -- legs and shoes --

    def _leg(self, side: int, tag: str) -> None:
        rig = self.rig
        hip, knee, foot = rig.rest[f"hip.{tag}"], rig.rest[f"knee.{tag}"], rig.rest[f"foot.{tag}"]
        points = bent(hip, knee, foot)
        radii = [0.52 - 0.05 * i / (len(points) - 1) for i in range(len(points))]
        lower = jointed(points)
        self.part(
            f"leg.{tag}",
            tube(points, radii),
            weights={f"thigh.{tag}": [1 - w for w in lower], f"shin.{tag}": lower},
            group="trousers",
        )
        # The turn-up at the bottom of the trouser leg: one line above the shoe.
        cuff = tube([foot + Vector((0, 0, 0.3)), foot + Vector((0, 0, -0.02))], [radii[-1] + 0.05, radii[-1] + 0.05])
        self.part(f"cuff.{tag}", cuff, weights={f"shin.{tag}": [1.0] * len(cuff[0])}, line=0.9)

        # The shoe is solid ink: long and pointed. It is built pointing straight
        # ahead; that he stands with his toes turned out is his stance
        # (`poses.py`), so a pose can point a foot where he is going. Heel to
        # toe: (how far along, half its width, its height).
        last = [(-0.44, 0.04, 0.3), (-0.38, 0.22, 0.62), (-0.2, 0.32, 0.86), (0.05, 0.35, 0.9), (0.3, 0.35, 0.6), (0.6, 0.31, 0.4), (0.9, 0.22, 0.26), (1.1, 0.1, 0.15), (1.2, 0.01, 0.07)]
        ahead, across = Vector((0.0, -1.0, 0.0)), Vector((-1.0, 0.0, 0.0))
        rings = []
        for along, half, height in last:
            ring = []
            for k in range(20):
                angle = 2 * math.pi * k / 20
                # Round on top, flat on the ground.
                lift = height * max(0.0, 0.42 + 0.58 * math.sin(angle))
                ring.append(Vector((foot.x, foot.y, 0.0)) + ahead * along + across * half * math.cos(angle) + Vector((0, 0, lift)))
            rings.append(ring)
        verts, faces = skin(rings)
        faces += [tuple(range(20)), tuple(range(len(verts) - 20, len(verts)))]
        self.part(f"shoe.{tag}", (verts, faces), bone=f"foot.{tag}", ink=True, smooth=2)


# -- the rig ----------------------------------------------------------------


class Rig:
    """Control bones you move, and the bones that follow them.

    Controls all point straight back (+Y), which leaves their axes the same as
    the world's: moving one by (1, 0, 0) moves it one unit to screen right, and
    turning one about Y rolls it in the picture plane.

    An arm is a shoulder, an elbow and a hand you place anywhere; the two
    bones between them stretch to reach, and the sleeve bends at the elbow.
    The hand points where `aim` is and turns its back to where `back` is.

    The tie and the coat hang from swing bones, which point down. Nothing
    places those by hand: `swing.py` lets them trail behind whatever he does.
    """

    # name: (where it rests, what it hangs from)
    CONTROLS: dict[str, tuple[tuple[float, float, float], str | None]] = {
        "root": ((0, 0, 0), None),
        # His hips, and everything above them.
        "body": ((0, 0, 4.0), "root"),
        # His back bends here: the chest carries his head and his arms.
        "chest": ((0, 0, 5.2), "body"),
        "head": ((0, 0, 7.3), "chest"),
        "hat": ((0, 0, BRIM_Z), "head"),
        "crown": ((0, 0, CROWN_Z), "hat"),
        # In the air in front of the hat, not on it.
        "brow.L": ((-BROW_X, -BROW_Y, BRIM_Z + BROW_Z), "hat"),
        "brow.R": ((BROW_X, -BROW_Y, BRIM_Z + BROW_Z), "hat"),
        # Inside the coat: the sleeve comes out of it rounded, so the shoulder
        # line is the coat's own.
        "shoulder.L": ((-1.2, 0, 6.48), "chest"),
        "shoulder.R": ((1.2, 0, 6.48), "chest"),
        "elbow.L": ((-1.72, -0.45, 5.05), "chest"),
        "elbow.R": ((1.72, -0.45, 5.05), "chest"),
        "hand.L": ((-1.74, -0.82, 3.8), "chest"),
        "hand.R": ((1.74, -0.82, 3.8), "chest"),
        "hip.L": ((-0.46, 0, 3.3), "body"),
        "hip.R": ((0.46, 0, 3.3), "body"),
        "knee.L": ((-0.53, -0.08, 2.05), "root"),
        "knee.R": ((0.53, -0.08, 2.05), "root"),
        "foot.L": ((-0.56, 0, 0.82), "root"),
        "foot.R": ((0.56, 0, 0.82), "root"),
        # Not a part of him: which way his coat is blown. Pull it and the
        # cloth streams after it, as it does behind him when he runs.
        "trail": ((0, 1.9, 1.7), "root"),
    }
    # name: (from this control, to this control)
    LIMBS = {"upper": ("shoulder", "elbow"), "lower": ("elbow", "hand"), "thigh": ("hip", "knee"), "shin": ("knee", "foot")}
    # name: (where it hangs from, where it ends, what carries it)
    SWINGS: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], str]] = {
        "tie.1": ((0, -0.82, 6.6), (0, -0.82, 5.75), "chest"),
        "tie.2": ((0, -0.82, 5.75), (0, -0.82, 4.85), "tie.1"),
        "tie.3": ((0, -0.82, 4.85), (0, -0.82, 3.9), "tie.2"),
        "coat.FR": ((0.7, -0.85, 5.3), (1.0, -1.25, 1.7), "body"),
        "coat.R": ((1.3, 0.1, 5.3), (1.9, 0.2, 1.7), "body"),
        "coat.B": ((0, 1.0, 5.3), (0, 1.44, 1.7), "body"),
        "coat.L": ((-1.3, 0.1, 5.3), (-1.9, 0.2, 1.7), "body"),
        "coat.FL": ((-0.7, -0.85, 5.3), (-1.0, -1.25, 1.7), "body"),
    }
    # The toon hand: which of its bones is which finger, thumb first.
    FINGERS = {
        "thumb": ("F1A", "F1B", "F1C"),
        "index": ("F2A", "F2B"),
        "middle": ("F3A", "F3B"),
        "ring": ("F4A", "F4B"),
        "little": ("F5A", "F5B"),
    }
    # In the hand's own space: where its wrist is, and where its glove cuff is cut off.
    HAND_WRIST = Vector((-0.3, -3.3, 0.3))
    HAND_CUT = -3.6

    _hand_data: dict | None = None

    @classmethod
    def hand_data(cls) -> dict:
        if cls._hand_data is None:
            cls._hand_data = json.loads(Path(__file__).with_name("toon_hand.json").read_text())
        return cls._hand_data

    def __init__(self, collection: bpy.types.Collection) -> None:
        old = bpy.data.objects.get(RIG)
        if old is not None:
            bpy.data.objects.remove(old)
        self.rest = {name: Vector(spot) for name, (spot, _) in self.CONTROLS.items()}
        self.rest.update({name: Vector(head) for name, (head, _, _) in self.SWINGS.items()})
        self.obj = bpy.data.objects.new(RIG, bpy.data.armatures.new(RIG))
        collection.objects.link(self.obj)
        self.obj.show_in_front = True
        bpy.context.view_layer.objects.active = self.obj
        bpy.ops.object.mode_set(mode="EDIT")
        bones = self.obj.data.edit_bones
        for name, (spot, parent) in self.CONTROLS.items():
            self._control(bones, name, Vector(spot), parent)
        for name, (head, tail, parent) in self.SWINGS.items():
            bone = bones.new(name)
            bone.head, bone.tail = Vector(head) * UNIT, Vector(tail) * UNIT
            bone.align_roll(Vector((0.0, -1.0, 0.0)))
            bone.parent = bones[parent]
        for side, tag in ((-1, "L"), (1, "R")):
            for name, (start, end) in self.LIMBS.items():
                bone = bones.new(f"{name}.{tag}")
                bone.head = self.rest[f"{start}.{tag}"] * UNIT
                bone.tail = self.rest[f"{end}.{tag}"] * UNIT
                if name in ("upper", "thigh"):
                    bone.parent = bones[f"{start}.{tag}"]
                else:
                    # The lower half of a limb turns with the upper half and
                    # bends from there. Left to find its own way to the hand
                    # or the foot it would twist against it, and the sleeve
                    # would wring thin at the elbow like a wet cloth.
                    bone.parent = bones[f"{'upper' if name == 'lower' else 'thigh'}.{tag}"]
                    bone.inherit_scale = "NONE"

            # The hand: where its fingers point and where its back faces are
            # two controls that travel with it.
            hand = self.rest[f"hand.{tag}"]
            along, across, back = self._hand_axes(tag)
            self._control(bones, f"aim.{tag}", hand + along, f"hand.{tag}")
            self._control(bones, f"back.{tag}", hand + back, f"hand.{tag}")
            palm = bones.new(f"palm.{tag}")
            palm.head, palm.tail = hand * UNIT, (hand + along * 0.5) * UNIT
            palm.align_roll(back)
            for name, bone_data in self.hand_data()["bones"].items():
                if name == "Hand":
                    continue
                finger = bones.new(f"{name}.{tag}")
                finger.head = self.hand_point(tag, bone_data["head"]) * UNIT
                finger.tail = self.hand_point(tag, bone_data["tail"]) * UNIT
                finger.align_roll(self._hand_turn(tag, bone_data["z"]))
            for name, bone_data in self.hand_data()["bones"].items():
                if name != "Hand":
                    parent = bone_data["parent"]
                    bones[f"{name}.{tag}"].parent = bones[f"palm.{tag}" if parent == "Hand" else f"{parent}.{tag}"]
        grip, out, _ = self.glass()
        glass = bones.new("glass")
        glass.head, glass.tail = grip * UNIT, (grip + out * 0.5) * UNIT
        glass.parent = bones["palm.R"]
        bpy.ops.object.mode_set(mode="OBJECT")

        pose = self.obj.pose.bones
        for tag in ("L", "R"):
            for name, (start, end) in self.LIMBS.items():
                bone = pose[f"{name}.{tag}"]
                if name in ("lower", "shin"):
                    follow = bone.constraints.new("COPY_LOCATION")
                    follow.target, follow.subtarget = self.obj, f"{start}.{tag}"
                reach = bone.constraints.new("STRETCH_TO")
                reach.target, reach.subtarget = self.obj, f"{end}.{tag}"
                reach.volume = "NO_VOLUME"
                reach.keep_axis = "SWING_Y"
            palm = pose[f"palm.{tag}"]
            follow = palm.constraints.new("COPY_LOCATION")
            follow.target, follow.subtarget = self.obj, f"hand.{tag}"
            # Point the fingers at `aim`, then roll the back of the hand to
            # face `back`. Between them they fix the hand completely.
            point = palm.constraints.new("DAMPED_TRACK")
            point.target, point.subtarget = self.obj, f"aim.{tag}"
            point.track_axis = "TRACK_Y"
            roll = palm.constraints.new("LOCKED_TRACK")
            roll.target, roll.subtarget = self.obj, f"back.{tag}"
            roll.track_axis, roll.lock_axis = "TRACK_Z", "LOCK_Y"
        for bone in pose:
            bone.rotation_mode = "QUATERNION" if bone.name in self.SWINGS else "XYZ"
        # Only the controls are shown. What follows them — limbs, fingers, the
        # swing bones — is there to be looked at, not in the way.
        shown = self.obj.data.collections.new("Controls")
        hidden = self.obj.data.collections.new("Followers")
        for bone in self.obj.data.bones:
            control = bone.name in self.CONTROLS or bone.name.split(".")[0] in ("aim", "back")
            (shown if control else hidden).assign(bone)
        hidden.is_visible = False

    @staticmethod
    def _control(bones: bpy.types.ArmatureEditBones, name: str, spot: Vector, parent: str | None) -> None:
        bone = bones.new(name)
        bone.head = spot * UNIT
        bone.tail = (spot + Vector((0, 0.6, 0))) * UNIT
        bone.roll = 0.0
        if parent:
            bone.parent = bones[parent]

    def _hand_axes(self, tag: str) -> tuple[Vector, Vector, Vector]:
        """At rest: the way the fingers point, the way across the palm away
        from the thumb, and the way the back of the hand faces."""
        along = (self.rest[f"hand.{tag}"] - self.rest[f"elbow.{tag}"]).normalized()
        # Thumbs forward, backs of the hands outward.
        across = (Vector((0.0, 1.0, 0.0)) - along * along.y).normalized()
        back = across.cross(along) * (1 if tag == "L" else -1)
        return along, across, back

    def glass(self) -> tuple[Vector, Vector, Vector]:
        """The magnifying glass in the hand on screen right, at rest: the
        middle of the fist that holds it, the way its handle runs out of the
        fist past the thumb, and the way its ring faces."""
        along, across, back = self._hand_axes("R")
        return self.rest["hand.R"] + along * 0.52, -across, back

    def _hand_turn(self, tag: str, vector: list[float]) -> Vector:
        """A direction in the toon hand's space, as it lies on this side of him."""
        along, across, back = self._hand_axes(tag)
        return across * vector[0] + along * vector[1] + back * vector[2]

    def hand_point(self, tag: str, point: list[float]) -> Vector:
        """A point of the toon hand, as it lies on this side of him."""
        spot = Vector(point) - self.HAND_WRIST
        # The heel of the hand is drawn in to a wrist, to go up the sleeve.
        slim = 0.6 + 0.4 * ramp(spot.y, 0.4, 2.8)
        spot.x, spot.z = spot.x * slim, spot.z * slim
        return self.rest[f"hand.{tag}"] + self._hand_turn(tag, list(spot * HAND_SCALE))

    def carry(self, obj: bpy.types.Object, bone: str) -> None:
        """Hang `obj` rigidly from `bone`, leaving it where it is."""
        rest = self.obj.data.bones[bone]
        basis = obj.matrix_basis.copy()
        obj.parent = self.obj
        obj.parent_type = "BONE"
        obj.parent_bone = bone
        # A bone's children hang from its tail.
        obj.matrix_parent_inverse = (rest.matrix_local @ Matrix.Translation((0, rest.length, 0))).inverted()
        obj.matrix_basis = basis

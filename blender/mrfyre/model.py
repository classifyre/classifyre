"""Mr. Fyre as a 3D model that renders like a drawing.

He is modelled for his silhouette from the front, posed by a small rig of
control bones (`Rig` below) and shot with an orthographic camera. There is no
lighting and no shading at all: `scene.py` renders which part is where, fills
the paper parts white and the ink parts black, and draws a line of one fixed
weight wherever two parts, or a part and the background, meet.

Parts that share a `group` are one shape to that line — the hat and its two
peaks, a palm and its fingers — so it runs round them and never between them.

Units throughout are character units: the ground is z = 0, the tip of the hat
about z = 10, he faces -Y, x is screen right.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Blender units per character unit: he stands 2 m tall.
UNIT = 0.2

# How far in front of the hat's middle the brows sit.
BROW_DEPTH = -1.3

COLLECTION = "MrFyre"
BROWS = "MrFyre.brows"
RIG = "MrFyre.rig"

Verts = list[tuple[float, float, float]]
Faces = list[tuple[int, ...]]
Shape = tuple[Verts, Faces]


# -- shapes -----------------------------------------------------------------


def lathe(
    profile: list[tuple[float, float]],
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 48,
    depth: float = 1.0,
    arc: tuple[float, float] | None = None,
) -> Shape:
    """`profile` — (radius, height) pairs — spun round the vertical axis.

    `depth` squashes it front to back. `arc` (degrees, 0 = screen right,
    -90 = front) spins only part of the way, leaving the shape open.
    """
    start, end = arc or (0.0, 360.0)
    count = segments if arc is None else segments + 1
    verts: Verts = []
    for radius, height in profile:
        for i in range(count):
            angle = math.radians(start + (end - start) * i / segments)
            verts.append(
                (center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle) * depth, center[2] + height)
            )
    faces: Faces = []
    for ring in range(len(profile) - 1):
        for i in range(count if arc is None else count - 1):
            a, b = ring * count + i, ring * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    return verts, faces


def rounded(profile: list[tuple[float, float]], steps: int = 6) -> list[tuple[float, float]]:
    """A profile with its corners curved: a spline through the points given."""
    points = [Vector((r, z)) for r, z in profile]
    padded = [points[0] * 2 - points[1], *points, points[-1] * 2 - points[-2]]
    out: list[tuple[float, float]] = []
    for i in range(1, len(points)):
        p0, p1, p2, p3 = padded[i - 1 : i + 3]
        for k in range(steps):
            t = k / steps
            spot = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t**3)
            out.append((spot.x, spot.y))
    out.append(profile[-1])
    return out


def ball(center: tuple[float, float, float] | Vector, rx: float, ry: float, rz: float, segments: int = 32) -> Shape:
    rings = segments // 2
    profile = [(math.sin(math.pi * i / rings), -math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    verts, faces = lathe(profile, segments=segments)
    return [(center[0] + x * rx, center[1] + y * ry, center[2] + z * rz) for x, y, z in verts], faces


def cone(apex: tuple[float, float, float], base: tuple[float, float, float], radius: float, segments: int = 48) -> Shape:
    """A cone whose point need not be over the middle of its base."""
    ring = [
        (base[0] + radius * math.cos(2 * math.pi * i / segments), base[1] + radius * math.sin(2 * math.pi * i / segments), base[2])
        for i in range(segments)
    ]
    faces: Faces = [(i, (i + 1) % segments, segments) for i in range(segments)]
    faces.append(tuple(range(segments)))
    return [*ring, apex], faces


def tube(points: list[Vector], radii: list[float], segments: int = 24) -> Shape:
    """A round limb through `points`, `radii[i]` thick at each."""
    verts: Verts = []
    for i, point in enumerate(points):
        ahead = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        side = ahead.cross(Vector((0.0, 1.0, 0.0))).normalized()
        front = side.cross(ahead)
        for k in range(segments):
            angle = 2 * math.pi * k / segments
            verts.append(tuple(point + (side * math.cos(angle) + front * math.sin(angle)) * radii[i]))
    faces: Faces = []
    for ring in range(len(points) - 1):
        for k in range(segments):
            a, b = ring * segments + k, ring * segments + (k + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(range(segments)))
    faces.append(tuple(range((len(points) - 1) * segments, len(points) * segments)))
    return verts, faces


def finger(start: Vector, end: Vector, radius: float) -> Shape:
    """A short tube with a round tip."""
    return joined(tube([start, end], [radius, radius * 0.9], segments=14), ball(end, radius * 0.9, radius * 0.9, radius * 0.9, 14))


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
        # Beside the body, not inside it: the brows are rendered on their own.
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
            self._leg(side, tag)

    @staticmethod
    def _material(name: str, color: tuple[float, float, float]) -> bpy.types.Material:
        """Only for looking at him in the viewport; the renderer does not use materials."""
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.use_nodes = False
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
        group: str | None = None,
        collection: bpy.types.Collection | None = None,
    ) -> bpy.types.Object:
        """One piece of him: paper (white, outlined) unless `ink` (black).

        `bone` carries it rigidly; `weights` (per vertex, per bone) bend it
        instead. Pieces with the same `group` are outlined as one shape.
        """
        verts, faces = shape
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(c * UNIT for c in v) for v in verts], [], faces)
        scratch = bmesh.new()
        scratch.from_mesh(mesh)
        bmesh.ops.remove_doubles(scratch, verts=scratch.verts, dist=1e-6)
        scratch.to_mesh(mesh)
        scratch.free()
        mesh.materials.append(self.ink if ink else self.paper)
        obj = bpy.data.objects.new(name, mesh)
        obj["fyre_group"] = group or name
        obj["fyre_ink"] = ink
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
        return obj

    def _head(self) -> None:
        # Only the lower half of the head is ever seen. The top is flattened so
        # that it stays inside the hat instead of coming through the crown.
        verts, faces = ball((0, 0, 7.47), 1.3, 1.25, 1.3, 40)
        verts = [(x, y, 7.47 + (z - 7.47) * 0.3 if z > 7.47 else z) for x, y, z in verts]
        self.part("head", (verts, faces), bone="head")
        for side, tag in ((-1, "L"), (1, "R")):
            # A lens is a white disc standing clear of the face, but behind the
            # brim, which hides the top of it. Its rim is the line drawn where
            # it meets the head.
            disc = [
                (side * 0.5 + 0.42 * math.cos(2 * math.pi * i / 40), -1.3, 7.2 + 0.42 * math.sin(2 * math.pi * i / 40))
                for i in range(40)
            ]
            self.part(f"lens.{tag}", plate(disc), bone="head")

    def _hat(self) -> None:
        brim = 7.6
        # From the front a shallow cone is a wedge with pointed tips: the brim.
        wedge = lathe([(0.0, 0.3), (2.0, -0.05), (2.07, 0.0), (1.12, 0.58), (0.0, 0.62)], center=(0, 0, brim), segments=64)
        # The crown is two wide cones leaning apart. Each one's outer edge runs
        # straight from the brim to its peak, and where they cross is the notch.
        # Measured off the sketches: peaks at -0.38 and 0.66, the notch at
        # (0.12, 1.6), the crown meeting the brim 1.15 either side.
        left = cone((-0.38, 0, brim + 2.5), (-0.21, 0, brim + 0.5), 0.94)
        right = cone((0.66, 0, brim + 2.5), (0.295, 0, brim + 0.5), 0.835)
        self.part("hat", joined(wedge, left, right), bone="hat")
        for side, tag in ((-1, "L"), (1, "R")):
            # A brow is a slab cut on the slant: straight edges, sharp corners.
            # They sit on the surface of the hat. Nothing can hide them: they
            # are drawn in a pass of their own and laid over the rest.
            y, z = BROW_DEPTH, brim + 0.38
            slab = [(-0.43, -0.085), (-0.33, 0.085), (0.43, 0.085), (0.33, -0.085)]
            self.part(
                f"brow.{tag}",
                plate([(side * 0.58 + side * x, y, z + dz) for x, dz in slab]),
                bone=f"brow.{tag}",
                ink=True,
                collection=self.brows,
            )

    def _body(self) -> None:
        # Shirt and trousers: one column, front to back thinner than it is wide.
        self.part("torso", lathe([(0.0, 2.55), (0.95, 2.75), (0.95, 6.2), (0.0, 6.4)], depth=0.75), bone="body", group="body")
        self.part("belt", lathe([(0.955, 3.02), (0.955, 3.24)], depth=0.76), bone="body", ink=True)
        y = -0.8
        self.part("tie", plate([(-0.1, y, 5.6), (0.1, y, 5.6), (0.26, y, 3.95), (0.02, y, 3.55), (-0.23, y, 3.95)]), bone="tie", ink=True)
        self.part("tie.knot", plate([(-0.2, y, 6.0), (0.2, y, 6.0), (0.13, y, 5.58), (-0.13, y, 5.58)]), bone="tie", ink=True)

    # The coat's radius at each height, hem to collar.
    COAT = rounded([(2.3, 1.3), (2.12, 2.4), (1.95, 3.6), (1.82, 4.7), (1.68, 5.5), (1.4, 6.05), (0.95, 6.35)])
    COAT_DEPTH = 0.72
    # Half the opening down the front, in degrees.
    COAT_GAP = 26.0

    def _coat(self) -> None:
        arc = (-90 + self.COAT_GAP, 270 - self.COAT_GAP)
        verts, faces = lathe(self.COAT, segments=56, depth=self.COAT_DEPTH, arc=arc)
        self.part("coat", (verts, faces), weights=self._swing(verts), group="coat")
        # Its inside is ink: the dark between his legs. It stops short of the
        # front edges and of the chest, so none of it shows beside them or at
        # the neck.
        inside = (arc[0] + 4, arc[1] - 4)
        lower = [(r - 0.05, z) for r, z in self.COAT if z < 4.4]
        verts, faces = lathe(lower, segments=56, depth=self.COAT_DEPTH, arc=inside)
        self.part("coat.lining", (verts, faces), weights=self._swing(verts), ink=True)
        # Collar and lapel are one piece each side. Its inner edge is the coat's
        # own front edge, so the two lines are one line; its top stands in
        # front of the bottom of the cheeks, so the jaw is inside the coat.
        edge = math.sin(math.radians(self.COAT_GAP))
        inner = [(edge * self._coat_radius(z), z) for z in (4.6, 5.0, 5.4, 5.8, 6.1, 6.3)]
        cut = [*inner, (0.48, 6.44), (1.3, 6.32), (1.56, 6.02), (1.15, 5.84), (1.6, 5.46)]
        for side, tag in ((-1, "L"), (1, "R")):
            lapel = [(side * x, -1.32 if z > 6.15 else min(self._coat_front(x, z) - 0.1, -0.75), z) for x, z in cut]
            self.part(f"lapel.{tag}", plate(lapel), bone="body")

    @staticmethod
    def _swing(verts: Verts) -> dict[str, list[float]]:
        """The lower the cloth, the more the hem controls move it."""
        weights: dict[str, list[float]] = {"body": [], "hem.L": [], "hem.R": []}
        for x, _, z in verts:
            swing = max(0.0, min(1.0, (4.9 - z) / 3.6)) ** 1.5
            left = max(0.0, min(1.0, 0.5 - x / 3.0))
            weights["hem.L"].append(swing * left)
            weights["hem.R"].append(swing * (1 - left))
            weights["body"].append(1 - swing)
        return weights

    def _coat_radius(self, z: float) -> float:
        for (r0, z0), (r1, z1) in zip(self.COAT, self.COAT[1:]):
            if z0 <= z <= z1:
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return self.COAT[-1][0]

    def _coat_front(self, x: float, z: float) -> float:
        """How far forward the coat's surface is at (x, z)."""
        radius = self._coat_radius(z)
        return -self.COAT_DEPTH * math.sqrt(max(radius * radius - x * x, 0.0))

    def _arm(self, side: int, tag: str) -> None:
        rig = self.rig
        shoulder, elbow, hand = rig.rest[f"shoulder.{tag}"], rig.rest[f"elbow.{tag}"], rig.rest[f"hand.{tag}"]
        along = (hand - elbow).normalized()
        wrist = hand - along * 0.4
        points = bent(shoulder, elbow, wrist)
        radii = [0.52 - 0.08 * i / (len(points) - 1) for i in range(len(points))]
        lower = jointed(points)
        self.part(f"sleeve.{tag}", tube(points, radii), weights={f"upper.{tag}": [1 - w for w in lower], f"lower.{tag}": lower})

        # A hand is built hanging straight down, flat to the camera: `down`
        # the arm, `thumb` towards the body, `front` towards the camera. Its
        # bone then turns it in the picture plane only, so it is never edge-on.
        down = Vector((0.0, 0.0, -1.0))
        thumb = Vector((-side, 0.0, 0.0))
        front = Vector((0.0, -1.0, 0.0))
        palm_bone, group = f"palm.{tag}", f"hand.{tag}"

        def at(a: float, t: float, f: float = 0.0) -> Vector:
            return hand + down * a + thumb * t + front * f

        # Fist: one rounded block.
        self.part(f"hand.fist.{tag}", ball(at(0.08, 0.0), 0.42, 0.36, 0.42), bone=palm_bone, group=group)

        # Pointing: the fist with the first finger out along the arm.
        pointing = joined(ball(at(0.05, 0.0), 0.4, 0.34, 0.38), finger(at(0.2, 0.2), at(1.0, 0.2), 0.14))
        self.part(f"hand.point.{tag}", pointing, bone=palm_bone, group=group)

        # Open: a mitten, with a short thumb low on its side.
        mitten = joined(ball(at(0.26, -0.03), 0.38, 0.2, 0.62), finger(at(-0.08, 0.2), at(0.06, 0.5), 0.14))
        self.part(f"hand.open.{tag}", mitten, bone=palm_bone, group=group)

    def _leg(self, side: int, tag: str) -> None:
        rig = self.rig
        hip, knee, foot = rig.rest[f"hip.{tag}"], rig.rest[f"knee.{tag}"], rig.rest[f"foot.{tag}"]
        points = bent(hip, knee, foot)
        radii = [0.52 - 0.08 * i / (len(points) - 1) for i in range(len(points))]
        lower = jointed(points)
        self.part(
            f"leg.{tag}",
            tube(points, radii),
            weights={f"thigh.{tag}": [1 - w for w in lower], f"shin.{tag}": lower},
            group="body",
        )
        # A shoe is a block with a rounded toe on a flat sole, turned out a little.
        heel = Vector((foot.x - side * 0.22, -0.3, 0.28))
        toe = Vector((foot.x + side * 0.5, -0.5, 0.26))
        verts, faces = joined(tube([heel, toe], [0.3, 0.27]), ball(toe, 0.27, 0.27, 0.27, 16))
        self.part(f"shoe.{tag}", ([(x, y, max(z, 0.0)) for x, y, z in verts], faces), bone=f"foot.{tag}")

# -- the rig ----------------------------------------------------------------


class Rig:
    """Control bones you move, and the bones that follow them.

    Controls all point straight back (+Y), which leaves their axes the same as
    the world's: moving one by (1, 0, 0) moves it one unit to screen right, and
    turning one about Y rolls it in the picture plane.

    An arm is a shoulder, an elbow and a hand you place anywhere; the two
    bones between them stretch to reach, and the sleeve bends at the elbow.
    """

    # name: (where it rests, what it hangs from)
    CONTROLS: dict[str, tuple[tuple[float, float, float], str | None]] = {
        "root": ((0, 0, 0), None),
        "body": ((0, 0, 3.1), "root"),
        "head": ((0, 0, 7.47), "body"),
        "hat": ((0, 0, 7.6), "head"),
        "brow.L": ((-0.58, BROW_DEPTH, 7.98), "hat"),
        "brow.R": ((0.58, BROW_DEPTH, 7.98), "hat"),
        "tie": ((0, -0.8, 5.95), "body"),
        "hem.L": ((-2.0, 0, 1.3), "body"),
        "hem.R": ((2.0, 0, 1.3), "body"),
        # Inside the coat: the sleeve comes out of it below the shoulder, so the
        # shoulder line is the coat's own.
        "shoulder.L": ((-1.05, 0, 5.6), "body"),
        "shoulder.R": ((1.05, 0, 5.6), "body"),
        "hip.L": ((-0.55, 0, 3.0), "body"),
        "hip.R": ((0.55, 0, 3.0), "body"),
        "elbow.L": ((-1.95, -0.45, 4.5), "root"),
        "elbow.R": ((1.95, -0.45, 4.5), "root"),
        "hand.L": ((-1.95, -0.65, 3.15), "root"),
        "hand.R": ((1.95, -0.65, 3.15), "root"),
        "knee.L": ((-0.75, 0, 1.75), "root"),
        "knee.R": ((0.75, 0, 1.75), "root"),
        "foot.L": ((-0.95, 0, 0.5), "root"),
        "foot.R": ((0.95, 0, 0.5), "root"),
    }
    # name: (from this control, to this control)
    LIMBS = {"upper": ("shoulder", "elbow"), "lower": ("elbow", "hand"), "thigh": ("hip", "knee"), "shin": ("knee", "foot")}

    def __init__(self, collection: bpy.types.Collection) -> None:
        old = bpy.data.objects.get(RIG)
        if old is not None:
            bpy.data.objects.remove(old)
        self.rest = {name: Vector(spot) for name, (spot, _) in self.CONTROLS.items()}
        self.obj = bpy.data.objects.new(RIG, bpy.data.armatures.new(RIG))
        collection.objects.link(self.obj)
        self.obj.show_in_front = True
        bpy.context.view_layer.objects.active = self.obj
        bpy.ops.object.mode_set(mode="EDIT")
        bones = self.obj.data.edit_bones
        for name, (spot, parent) in self.CONTROLS.items():
            bone = bones.new(name)
            bone.head = Vector(spot) * UNIT
            bone.tail = (Vector(spot) + Vector((0, 0.6, 0))) * UNIT
            bone.roll = 0.0
            if parent:
                bone.parent = bones[parent]
        for tag in ("L", "R"):
            for name, (start, end) in self.LIMBS.items():
                bone = bones.new(f"{name}.{tag}")
                bone.head = self.rest[f"{start}.{tag}"] * UNIT
                bone.tail = self.rest[f"{end}.{tag}"] * UNIT
                if name in ("upper", "thigh"):
                    bone.parent = bones[f"{start}.{tag}"]
            palm = bones.new(f"palm.{tag}")
            palm.head = self.rest[f"hand.{tag}"] * UNIT
            palm.tail = (self.rest[f"hand.{tag}"] + Vector((0, 0.6, 0))) * UNIT
            palm.roll = 0.0
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
            palm = pose[f"palm.{tag}"]
            follow = palm.constraints.new("COPY_LOCATION")
            follow.target, follow.subtarget = self.obj, f"hand.{tag}"
            # The hand follows the forearm by turning about the camera's axis
            # and no other: its top always points back up the arm.
            turn = palm.constraints.new("LOCKED_TRACK")
            turn.target, turn.subtarget = self.obj, f"elbow.{tag}"
            turn.track_axis, turn.lock_axis = "TRACK_Z", "LOCK_Y"
        for bone in pose:
            bone.rotation_mode = "XYZ"

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

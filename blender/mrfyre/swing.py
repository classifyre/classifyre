"""The tie and the coat.

Nothing poses them. Each hangs from swing bones, and a swing bone is a weight
on a spring: when what it hangs from moves, it is left behind, catches up,
overshoots and settles. That is all the secondary motion there is, and it
comes from the rig, not from the picture.

Standing still, the weights rest: straight down for the tie, and for the coat
a little out to the side of an arm that is raised, or of a knee that comes
forward and pushes the front of it aside. A pose can blow the coat
(the `trail` control): it then rests streaming that way, the back of it
furthest. And the coat cannot go through the ground: when he crouches it
spreads out round him a little, and what is left over gathers up.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

from .model import RIG, UNIT, Rig

# For each kind of swing bone: how hard the spring pulls it back, how fast it
# loses its swing (both per frame, at 30 a second), and the furthest it may
# swing, in degrees.
SPRINGS = {"tie": (0.12, 0.26, 26.0), "coat": (0.1, 0.3, 18.0)}
# How much cloth hangs plumb rather than leaning with him: 0 is stiff as
# card, 1 always straight down.
PLUMB = 0.65
# An arm that lifts takes the coat on its side with it: degrees of swing
# outward for each unit the elbow rises, and the most that can be.
PULL = (9.0, 16.0)
# A knee that comes forward pushes its side of the coat's front aside: degrees
# of swing outward for each unit the knee comes forward, and the most.
KNEE = (16.0, 26.0)
# How much of the `trail` control each part of the coat takes: the back
# streams out, the front panels hold nearer to him, so the coat fans open.
TRAIL = {"coat.B": 1.0, "coat.L": 0.75, "coat.R": 0.75, "coat.FL": 0.4, "coat.FR": 0.4, "tie.1": 0.5, "tie.2": 0.5, "tie.3": 0.5}
# The hem stays this far above the ground, in character units. Meeting the
# ground the coat spreads out by no more than this many degrees; beyond that
# it gathers, its swing bones growing shorter.
FLOOR = 0.14
SPREAD = 15.0
STEPS = 6


class Swings:
    """Every swing bone, each a weight that trails behind its own rest."""

    def __init__(self) -> None:
        self.rig = bpy.data.objects[RIG]
        bones = self.rig.data.bones
        self.names = list(Rig.SWINGS)
        # Where each bone sits in what carries it, when nothing has moved it.
        self.seat = {name: bones[name].parent.matrix_local.inverted() @ bones[name].matrix_local for name in self.names}
        self.weight: dict[str, Vector] = {}
        self.speed: dict[str, Vector] = {}
        self.hang: dict[str, Vector] = {}

    def _rest(self, name: str, frame: Matrix, body: Matrix) -> Vector:
        """Which way a bone hangs when it is at rest, him standing as he is."""
        bone = self.rig.data.bones[name]
        carried = frame.to_3x3().col[1].normalized()
        # The same bone if he had only turned on the spot, not leaned.
        ahead = body.to_3x3().col[1]
        turned = Matrix.Rotation(math.atan2(-ahead.x, ahead.y), 3, "Z")
        hang = carried.lerp(turned @ bone.matrix_local.to_3x3().col[1], PLUMB).normalized()
        tag = {"coat.L": "L", "coat.FL": "L", "coat.R": "R", "coat.FR": "R"}.get(name)
        if tag is not None:
            front = "F" in name
            rise = max(0.0, self.rig.pose.bones[f"elbow.{tag}"].location.z / UNIT)
            swing = math.radians(min(PULL[0] * rise, PULL[1])) * (0.6 if front else 1.0)
            out = body.to_3x3() @ Vector((-1.0 if tag == "L" else 1.0, -0.4 if front else 0.0, 0.0)).normalized()
            hang = (hang + out * math.tan(swing)).normalized()
        if name in ("coat.FL", "coat.FR"):
            reach = max(0.0, -self.rig.pose.bones[f"knee.{tag}"].location.y / UNIT)
            swing = math.radians(min(KNEE[0] * reach, KNEE[1]))
            out = body.to_3x3() @ Vector((-1.0 if tag == "L" else 1.0, -0.3, 0.0)).normalized()
            hang = (hang + out * math.tan(swing)).normalized()
        if name in TRAIL:
            blown = self.rig.pose.bones["trail"]
            hang = (hang + blown.parent.matrix.to_3x3() @ blown.location / UNIT * TRAIL[name]).normalized()
        return hang

    def _clear(self, bone: bpy.types.PoseBone, head: Vector, hang: Vector, chest: Matrix, hips: Matrix) -> Vector:
        """A way for a bone to hang, kept out of him and out of the ground. The
        tie cannot swing into his chest, no further back than it lies when he
        stands straight, and its end cannot go in behind his belt. The coat
        cannot hang lower than the ground: it spreads outward instead, as far
        as `SPREAD`."""
        if not bone.name.startswith("tie"):
            length = bone.bone.length
            # How far down it may point: all the way, when he is standing.
            down = min((head.z - FLOOR * UNIT) / length, 1.0)
            if -hang.z <= down:
                return hang
            down = max(down, math.cos(math.radians(SPREAD)))
            if -hang.z <= down:
                return hang
            flat = Vector((hang.x, hang.y, 0.0))
            if flat.length < 1e-4:
                flat = Vector((head.x - hips.translation.x, head.y - hips.translation.y, 0.0))
            return flat.normalized() * math.sqrt(1 - down * down) - Vector((0.0, 0.0, down))
        turn = chest.to_3x3()
        local = turn.inverted() @ hang
        flat = bone.bone.matrix_local.to_3x3().col[1].y
        if local.y > flat:
            local.y = flat
            hang = (turn @ local).normalized()
        end = hips.inverted() @ (head + hang * bone.bone.length)
        front = bone.bone.tail_local.y
        if end.y > front:
            end.y = front
            hang = (hips @ end - head).normalized()
        return hang

    def step(self, shift: Vector | None = None, settle: bool = False, home: float = 0.0) -> float:
        """Move every swing bone on by one frame and say how much is still moving.

        `shift` is how far he has travelled across the picture, which the rig
        does not show but the cloth feels. `settle` drops everything straight
        to rest instead. `home`, from 0 to 1, draws it in towards rest: a
        move has to end exactly where the pose's own sprite takes over.
        """
        shift = shift or Vector()
        bpy.context.view_layer.update()
        pose = self.rig.pose.bones
        # The tie hangs from his chest, the coat from his hips.
        hips, chest = pose["body"].matrix.copy(), pose["chest"].matrix.copy()
        frames: dict[str, Matrix] = {}
        moving = 0.0
        for name in self.names:
            bone = pose[name]
            body = chest if name.startswith("tie") else hips
            carried = frames.get(bone.parent.name, bone.parent.matrix)
            frame = carried @ self.seat[name]
            head, length = frame.translation, bone.bone.length
            rest = self._rest(name, frame, body)
            goal = head + rest * length + shift
            pull, drag, limit = SPRINGS[name.split(".")[0]]
            if settle or name not in self.weight:
                self.weight[name], self.speed[name] = goal.copy(), Vector()
            weight, speed = self.weight[name].copy(), self.speed[name].copy()
            for _ in range(STEPS):
                speed += ((goal - weight) * pull - speed * drag) / STEPS
                weight += speed / STEPS
            # It is a bone, not elastic: keep it its own length, and inside
            # how far it may swing.
            hang = (weight - shift - head).normalized()
            angle = rest.angle(hang, 0.0)
            if angle > math.radians(limit):
                hang = rest.slerp(hang, math.radians(limit) / angle)
            hang, still = self._clear(bone, head, hang, chest, hips), self._clear(bone, head, rest, chest, hips)
            if home > 0:
                hang = hang.slerp(still, min(home, 1.0))
            kept = head + shift + hang * length
            self.speed[name] = speed + (kept - weight) * 0.5
            self.weight[name] = kept
            swung = frame.to_3x3().col[1].normalized().rotation_difference(hang)
            local = frame.to_quaternion().inverted() @ swung @ frame.to_quaternion()
            bone.rotation_quaternion = local
            # Cloth that would still reach under the ground gathers instead.
            room = (head.z - FLOOR * UNIT) / length
            bone.scale = (1.0, min(1.0, room / -hang.z) if hang.z < 0 and not name.startswith("tie") else 1.0, 1.0)
            frames[name] = frame @ local.to_matrix().to_4x4()
            # How far its end went this frame, and how far it still is from
            # where it will stop, in character units.
            moving = max(moving, (hang - self.hang.get(name, hang)).length * length / UNIT, (hang - still).length * length / UNIT)
            self.hang[name] = hang
        return moving

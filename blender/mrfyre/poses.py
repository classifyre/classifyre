"""The pose, hand and emotion libraries.

A pose says where the controls go; anything it leaves out stays at rest.

    "at"    put a hand, elbow, foot or knee here, in character units
            (x screen right, y away from the camera, z up; ground is z = 0)
    "move"  shift a control from where it rests
    "turn"  rotate it, in degrees: (nod forward, roll clockwise, turn to screen right)

These are his own directions and turn with him: turned to walk off screen
right, "forward" for his feet and hands is still -y.

Turning `root` turns all of him, feet included; turning `body` turns him above
the legs, and `chest` above the waist. A pose is laid over `STANCE`, how he
stands anyway: its moves and turns add to the stance's. The hat's own slant
(`HAT_TILT` in scene.py) is added to every pose.

`hands` picks the shape of each hand from `HANDS`, or "pocket" for no hand at
all: put the wrist inside the coat, or behind the other arm, and the sleeve
ends there. A hand points along its forearm with its back turned outward and
a little up. To turn it another way give `palm.L` / `palm.R` an "aim" (where
the fingers point) or a "back" (where the back of the hand faces), as
directions; with `"picture": True` they are directions in the picture, not
his own. `"glass": True` puts his magnifying glass in the hand on screen
right: its handle runs out of the fist on the thumb side, and its ring faces
the way the back of the hand does.

`trail` blows his coat: move it and the coat streams that way, as it does
behind him when he runs.

"L" is the side on screen left when he faces us; turned to screen right it is
the side nearer the camera. At rest the shoulders are at (±1.2, 0, 6.48), the
elbows at (±1.72, -0.45, 5.05), the hands at (±1.74, -0.82, 3.8), the hips at
(±0.46, 0, 3.3), the knees at (±0.53, -0.08, 2.05), the ankles at
(±0.56, 0, 0.82) and the middle of the head at (0, 0, 8.2).
"""

from __future__ import annotations

_POCKET_L = {"elbow.L": {"at": (-1.74, -0.92, 4.85)}, "hand.L": {"at": (-1.0, -0.52, 3.98)}}
_POCKET_R = {"elbow.R": {"at": (1.74, -0.92, 4.85)}, "hand.R": {"at": (1.0, -0.52, 3.98)}}
_POCKETS = {**_POCKET_L, **_POCKET_R, "hands": {"L": "pocket", "R": "pocket"}}
# A fist on the hip, for the arm that is not doing anything.
_HIP_L = {"elbow.L": {"at": (-2.65, -0.15, 5.0)}, "hand.L": {"at": (-1.7, -0.85, 4.3)}, "palm.L": {"back": (-0.4, -1, 0.2)}}
_HIP_R = {"elbow.R": {"at": (2.65, -0.15, 5.0)}, "hand.R": {"at": (1.7, -0.85, 4.3)}, "palm.R": {"back": (0.4, -1, 0.2)}}

# How far, in degrees, he stands with his toes turned out.
TOES_OUT = 42.0


def _leg(tag: str, knee: tuple[float, float, float], ankle: tuple[float, float, float], tip: float = 0.0) -> dict:
    """A leg for a pose in which he is going somewhere: its knee and ankle
    where given, the foot pointing straight ahead and not out, tipped onto its
    toe by `tip` degrees (onto its heel, if negative). Tipping turns the shoe
    about the ankle: an ankle 0.82 up has the sole flat on the ground."""
    ahead = TOES_OUT if tag == "L" else -TOES_OUT - 6
    return {f"knee.{tag}": {"at": knee}, f"foot.{tag}": {"at": ankle, "turn": (tip, 0, ahead)}}


# How he stands when a pose says nothing else, written like a pose. Nobody's
# back is a rod: his hips are forward and a little to one side, his weight on
# the leg on screen left, his chest rounded over them and his head carried
# forward, so that the coat hangs away from him in front. Every pose is laid
# over this: its moves and turns add to these.
STANCE: dict[str, dict] = {
    "body": {"move": (-0.07, -0.16, -0.03), "turn": (-5, 1.5, 0)},
    "chest": {"turn": (9, -3, 0)},
    "head": {"turn": (-2, 1, 0)},
    "knee.R": {"move": (0.06, -0.14, 0)},
    "foot.L": {"turn": (0, 0, -TOES_OUT)},
    "foot.R": {"move": (0.1, -0.06, 0), "turn": (0, 0, TOES_OUT + 6)},
}

# Seen from the side he does not turn all the way: his body goes most of the
# way round and his face stays half towards us, so that both lenses and both
# brows are still in the picture.
_SIDE = {"root": {"turn": (0, 0, 78)}, "head": {"turn": (0, 0, -42)}}
# Running: leaning into it, the near leg reaching forward and the far one
# pushing off behind, fists pumping the other way about, coat streaming.
_RUN = {
    "body": {"move": (0, -0.35, -0.05), "turn": (20, 0, 0)},
    "chest": {"turn": (4, 0, 0)},
    **_leg("L", (-0.5, -1.4, 2.45), (-0.5, -1.8, 1.2), -12),
    **_leg("R", (0.5, 0.7, 2.25), (0.5, 1.8, 1.45), 50),
    "elbow.L": {"at": (-1.5, 0.85, 5.4)},
    "hand.L": {"at": (-1.55, -0.3, 4.9)},
    "elbow.R": {"at": (1.5, -0.95, 5.45)},
    "hand.R": {"at": (1.35, -1.9, 6.3)},
    "hands": {"L": "fist", "R": "fist"},
    "trail": {"move": (0, 0.55, 0.12)},
}

POSES: dict[str, dict] = {
    # Hands in the coat pockets, elbows out: how he stands when he is doing nothing.
    "pockets": {**_POCKETS, "head": {"turn": (0, 2, 0)}},
    # The same, standing three-quarters on: the drawing he was designed from.
    # The far elbow is tucked in: turned, it would otherwise leave a chink of
    # background between the arm and the coat.
    "aside": {**_POCKETS, "elbow.R": {"at": (1.6, -0.92, 4.85)}, "root": {"turn": (0, 0, 24)}, "head": {"turn": (0, 0, -8)}},
    # And three-quarters on the other way.
    "away": {**_POCKETS, "elbow.L": {"at": (-1.6, -0.92, 4.85)}, "root": {"turn": (0, 0, -24)}, "head": {"turn": (0, 0, 8)}},
    # Arms at his sides, the backs of his hands to us.
    "idle": {"palm.L": {"back": (-0.35, -1, 0.1)}, "palm.R": {"back": (0.35, -1, 0.1)}},
    # Fists on hips, leaning in.
    "hips": {**_HIP_L, **_HIP_R, "hands": {"L": "fist", "R": "fist"}, "body": {"turn": (4, 0, 0)}, "head": {"turn": (0, -3, 0)}},
    # Hello.
    "wave": {
        **_POCKET_L,
        "elbow.R": {"at": (2.55, -0.3, 5.75)},
        "hand.R": {"at": (3.05, -0.55, 7.3)},
        "palm.R": {"back": (0.15, 1, 0)},
        "hands": {"L": "pocket", "R": "open"},
        "body": {"turn": (0, 3, 0)},
        "head": {"turn": (0, 4, 0)},
    },
    # Pointing at something to screen right.
    "point": {
        **_HIP_L,
        "elbow.R": {"at": (2.5, -0.35, 6.05)},
        "hand.R": {"at": (3.85, -0.6, 6.3)},
        "palm.R": {"back": (0, -0.5, 1)},
        "hands": {"L": "fist", "R": "point"},
        "body": {"turn": (0, 4, 9)},
        "head": {"turn": (0, 0, 8)},
    },
    # One finger up: and another thing.
    "aha": {
        **_POCKET_L,
        "elbow.R": {"at": (2.1, -0.75, 5.35)},
        "hand.R": {"at": (2.25, -1.15, 6.75)},
        "palm.R": {"aim": (0.05, 0, 1), "back": (0.2, -1, 0)},
        "hands": {"L": "pocket", "R": "point"},
        "body": {"move": (0, 0, 0.1), "turn": (-2, 0, 0)},
        "head": {"turn": (-3, 3, 4)},
    },
    # Open hand held out to screen right: "here it is".
    "present": {
        **_POCKET_L,
        "elbow.R": {"at": (2.35, -0.45, 4.85)},
        "hand.R": {"at": (3.5, -0.85, 5.35)},
        "palm.R": {"back": (0.25, 0.45, -1)},
        "hands": {"L": "pocket", "R": "open"},
        "body": {"turn": (0, 2, 7)},
        "head": {"turn": (0, 2, 6)},
    },
    # A hand turned up in front of him: talking it through.
    "explain": {
        **_POCKET_L,
        "elbow.R": {"at": (2.0, -0.6, 4.8)},
        "hand.R": {"at": (2.95, -1.05, 5.15)},
        "palm.R": {"back": (0.15, 0.35, -1)},
        "hands": {"L": "pocket", "R": "open"},
        "body": {"turn": (2, 0, -4)},
        "head": {"turn": (0, -3, 4)},
    },
    # Fist under his chin, the other arm across the body.
    "think": {
        "elbow.L": {"at": (-1.65, -1.0, 4.7)},
        "hand.L": {"at": (0.5, -1.4, 4.85)},
        "palm.L": {"back": (0, -1, 0.3)},
        "elbow.R": {"at": (1.2, -1.75, 4.95)},
        "hand.R": {"at": (0.72, -1.95, 6.25)},
        "palm.R": {"aim": (-0.4, 0.25, 1), "back": (0.5, -1, 0)},
        "hands": {"L": "fist", "R": "chin"},
        "body": {"turn": (0, -1, -5)},
        "chest": {"turn": (-2, -2, 0)},
        "head": {"turn": (5, -4, -6)},
    },
    # Bent to his magnifying glass, looking through it.
    "inspect": {
        **_HIP_L,
        "elbow.R": {"at": (2.05, -1.1, 5.35)},
        "hand.R": {"at": (1.5, -2.0, 6.55)},
        "palm.R": {"aim": (-1, 0.1, 0.2), "back": (0.1, -1, 0)},
        "hands": {"L": "fist", "R": "grip"},
        "glass": True,
        "body": {"turn": (6, 2, 6)},
        "head": {"turn": (4, 3, 8)},
    },
    # Palms up: who knows.
    "shrug": {
        "elbow.L": {"at": (-2.3, -0.4, 5.25)},
        "hand.L": {"at": (-3.3, -0.75, 6.0)},
        "palm.L": {"back": (-0.2, 0.4, -1)},
        "elbow.R": {"at": (2.3, -0.4, 5.25)},
        "hand.R": {"at": (3.3, -0.75, 6.0)},
        "palm.R": {"back": (0.2, 0.4, -1)},
        "hands": {"L": "open", "R": "open"},
        "body": {"move": (0, 0, 0.12)},
        "head": {"turn": (0, -7, 0)},
    },
    # Both hands up, hat off his head.
    "shock": {
        "elbow.L": {"at": (-2.6, -0.3, 5.95)},
        "hand.L": {"at": (-3.0, -0.5, 7.6)},
        "palm.L": {"back": (-0.15, 1, 0)},
        "elbow.R": {"at": (2.6, -0.3, 5.95)},
        "hand.R": {"at": (3.0, -0.5, 7.6)},
        "palm.R": {"back": (0.15, 1, 0)},
        "hands": {"L": "open", "R": "open"},
        "body": {"move": (0, 0, 0.15), "turn": (-4, 0, 0)},
        "hat": {"move": (0, 0, 0.55), "turn": (0, 6, 0)},
    },
    # -- going somewhere --
    # Walking off to screen right, hands in his pockets: caught mid-stride,
    # the near foot landing on its heel, the far one leaving on its toe.
    "walk": {
        **_SIDE,
        **_POCKETS,
        "body": {"move": (0, -0.1, -0.1), "turn": (4, 0, 0)},
        **_leg("L", (-0.5, -0.8, 2.0), (-0.5, -1.2, 0.9), -14),
        **_leg("R", (0.5, 0.3, 1.95), (0.5, 1.1, 1.25), 28),
        "trail": {"move": (0, 0.3, 0)},
    },
    # Running to screen right, at full stretch, coat flying.
    "run": {**_SIDE, **_RUN},
    # The same run, coming at us three-quarters on.
    "dash": {**_RUN, "root": {"turn": (0, 0, 36)}, "head": {"turn": (0, 0, -8)}},
    # -- on the case --
    # Down on one knee over a clue, peering at it through his glass.
    "crouch": {
        "root": {"turn": (0, 0, 60)},
        "body": {"move": (0, -0.25, -1.75), "turn": (19, 0, 0)},
        "chest": {"turn": (14, 0, 0)},
        "head": {"turn": (10, 0, -28)},
        # The near knee is up; the far one is on the ground, that foot on its toe.
        **_leg("L", (-0.8, -1.5, 2.35), (-0.85, -1.6, 0.85)),
        **_leg("R", (0.55, -1.0, 0.55), (0.55, 0.15, 1.3), 70),
        **_POCKET_L,
        "elbow.R": {"at": (1.5, -1.2, 5.3)},
        "hand.R": {"at": (1.0, -2.4, 5.3)},
        "palm.R": {"aim": (-0.55, 0, -0.8), "back": (0, 1, 0), "picture": True},
        "hands": {"L": "pocket", "R": "grip"},
        "glass": True,
    },
    # Lunging to point at something on screen right: you!
    "accuse": {
        "root": {"turn": (0, 0, 30)},
        "body": {"move": (0, -0.55, -0.3), "turn": (16, 0, 4)},
        "chest": {"turn": (4, 3, 8)},
        "head": {"turn": (0, 0, -6)},
        "knee.R": {"at": (0.7, -1.2, 2.0)},
        "foot.R": {"at": (0.8, -1.6, 0.82)},
        "knee.L": {"at": (-0.6, 0.3, 1.9)},
        "foot.L": {"at": (-0.7, 0.95, 1.0), "turn": (16, 0, 0)},
        "elbow.R": {"at": (2.1, -1.1, 6.4)},
        "hand.R": {"at": (2.95, -2.15, 6.3)},
        "palm.R": {"back": (0, -0.3, 1)},
        "elbow.L": {"at": (-1.85, 0.55, 5.2)},
        "hand.L": {"at": (-2.0, 0.5, 4.0)},
        "hands": {"L": "fist", "R": "point"},
        "trail": {"move": (0, 0.45, 0)},
    },
    # -- standing, but not like a post --
    # Seen from the side, fist to his chin: the other drawing he was designed from.
    "ponder": {
        **_SIDE,
        **_POCKET_R,
        "chest": {"turn": (-3, 0, 0)},
        "head": {"turn": (6, 0, -42)},
        "elbow.L": {"at": (-1.35, -1.45, 5.55)},
        "hand.L": {"at": (-0.5, -1.25, 6.75)},
        "palm.L": {"aim": (0.3, 0, 1), "back": (0, -1, 0), "picture": True},
        "hands": {"L": "chin", "R": "pocket"},
    },
    # Arms folded. The hand that is underneath is out of sight behind the other arm.
    "crossed": {
        "chest": {"turn": (-4, 0, 0)},
        "head": {"turn": (0, -3, 0)},
        "elbow.L": {"at": (-1.65, -0.85, 5.3)},
        "hand.L": {"at": (0.95, -1.45, 5.7)},
        "palm.L": {"back": (0, -1, 0.2)},
        "elbow.R": {"at": (1.65, -0.9, 4.95)},
        "hand.R": {"at": (-1.2, -0.95, 4.95)},
        "hands": {"R": "pocket"},
    },
    # His back to us, looking off over his shoulder. His arms hang a little
    # behind him: forward of his sides, from here, daylight shows between an
    # arm and the coat.
    "back": {
        "root": {"turn": (0, 0, 158)},
        "head": {"turn": (0, 0, -22)},
        "elbow.L": {"at": (-1.5, 0.2, 5.05)},
        "hand.L": {"at": (-1.52, 0.35, 3.85)},
        "elbow.R": {"at": (1.5, 0.2, 5.05)},
        "hand.R": {"at": (1.52, 0.35, 3.85)},
    },
}

# A hand shape is how far each finger folds, in degrees: (at the knuckle, at
# the joint, spread sideways). The thumb has three joints and its spread
# swings it across the palm.
HANDS: dict[str, dict[str, tuple[float, ...]]] = {
    # Hanging loose.
    "relaxed": {"thumb": (10, 15, 10, 10), "index": (22, 25, 0), "middle": (30, 30, 0), "ring": (36, 34, 0), "little": (42, 36, 0)},
    "fist": {"thumb": (25, 35, 40, 45), "index": (85, 95, 0), "middle": (88, 98, 0), "ring": (88, 98, 0), "little": (86, 96, 0)},
    "point": {"thumb": (25, 35, 40, 45), "index": (0, 0, 0), "middle": (88, 98, 0), "ring": (88, 98, 0), "little": (86, 96, 0)},
    # Fingers together and nearly straight.
    "open": {"thumb": (0, 5, 5, -12), "index": (4, 6, 4), "middle": (6, 8, 0), "ring": (8, 10, -3), "little": (12, 12, -8)},
    # A loose fist with the first finger crooked over it, for under the chin.
    "chin": {"thumb": (10, 20, 20, 20), "index": (55, 70, 0), "middle": (82, 94, 0), "ring": (86, 96, 0), "little": (86, 96, 0)},
    # Round a handle.
    "grip": {"thumb": (15, 30, 35, 35), "index": (70, 82, 0), "middle": (74, 86, 0), "ring": (76, 88, 0), "little": (76, 88, 0)},
}

# What the brows do: (roll in degrees, lift) for the screen-left and the
# screen-right brow. A positive roll raises the inner end; a lift raises the
# brow, which hangs in the air in front of the hat.
EMOTIONS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    # One brow cocked, one flat.
    "wry": ((20, 0.05), (0, -0.02)),
    "neutral": ((0, 0), (0, 0)),
    "stern": ((-22, 0), (-22, 0)),
    "worried": ((22, 0.04), (22, 0.04)),
    "skeptical": ((-6, -0.04), (20, 0.14)),
    "surprised": ((6, 0.2), (6, 0.2)),
    "focused": ((-9, -0.05), (-9, -0.05)),
    "suspicious": ((-15, -0.04), (3, -0.03)),
    "happy": ((12, 0.09), (12, 0.09)),
}

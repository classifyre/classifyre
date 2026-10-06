"""The pose and emotion libraries.

A pose says where the controls go; anything it leaves out stays at rest.

    "at"    put a hand, elbow, foot or knee here, in character units
            (x screen right, y away from the camera, z up; ground is z = 0)
    "move"  shift a control from where it rests
    "turn"  rotate it, in degrees: (nod back, roll clockwise, turn to screen right)

The hat's own slant (`HAT_TILT` in scene.py) is added to every pose.

`hands` picks the shape of each hand: fist, open (a mitten), point, or pocket
(no hand: the sleeve ends in the coat). "L" is the arm on screen left. At rest the
shoulders are at (±1.05, 0, 5.6), the elbows at (±1.95, -0.45, 4.5), the hands
at (±1.95, -0.65, 3.15) and the head at (0, 0, 7.47). Keep arms at y = -0.45 or
nearer the camera, so that they pass in front of the coat.
"""

from __future__ import annotations

# A fist on the hip, for the arm that is not doing anything.
_HIP_L = {"elbow.L": {"at": (-2.7, -0.5, 4.7)}, "hand.L": {"at": (-1.8, -0.9, 3.75)}}

POSES: dict[str, dict] = {
    # Arms at his sides.
    "idle": {},
    # Hands in the coat pockets, elbows out.
    "pockets": {
        "elbow.L": {"at": (-2.45, -0.5, 4.55)},
        "hand.L": {"at": (-1.45, -1.0, 3.3)},
        "elbow.R": {"at": (2.45, -0.5, 4.55)},
        "hand.R": {"at": (1.45, -1.0, 3.3)},
        "hands": {"L": "pocket", "R": "pocket"},
        "head": {"turn": (0, 3, 0)},
        "hat": {"turn": (0, -4, 0)},
    },
    # Fists on hips.
    "hips": {
        **_HIP_L,
        "elbow.R": {"at": (2.7, -0.5, 4.7)},
        "hand.R": {"at": (1.8, -0.9, 3.75)},
        "head": {"turn": (0, -3, 0)},
    },
    # Hello.
    "wave": {
        "elbow.R": {"at": (2.75, -0.5, 5.3)},
        "hand.R": {"at": (3.4, -0.6, 7.0)},
        "hands": {"R": "open"},
        "head": {"turn": (0, 5, 0)},
    },
    # Pointing at something to screen right.
    "point": {
        **_HIP_L,
        "elbow.R": {"at": (2.7, -0.5, 5.85)},
        "hand.R": {"at": (4.1, -0.6, 5.95)},
        "hands": {"R": "point"},
        "head": {"turn": (0, 3, 14)},
    },
    # Open hand held out to screen right: "here it is".
    "present": {
        "elbow.R": {"at": (2.6, -0.5, 4.75)},
        "hand.R": {"at": (3.8, -0.7, 5.3)},
        "hands": {"R": "open"},
        "head": {"turn": (0, 3, 10)},
    },
    # Hand on chin, the other arm across the body.
    "think": {
        "elbow.L": {"at": (-1.9, -1.0, 4.2)},
        "hand.L": {"at": (0.35, -1.5, 4.4)},
        "elbow.R": {"at": (1.85, -1.3, 4.5)},
        "hand.R": {"at": (0.85, -1.9, 6.15)},
        "head": {"turn": (0, -7, -10)},
    },
    # Palms up: who knows.
    "shrug": {
        "elbow.L": {"at": (-2.5, -0.5, 4.95)},
        "hand.L": {"at": (-3.6, -0.7, 5.75)},
        "elbow.R": {"at": (2.5, -0.5, 4.95)},
        "hand.R": {"at": (3.6, -0.7, 5.75)},
        "hands": {"L": "open", "R": "open"},
        "head": {"turn": (0, -8, 0)},
    },
    # Both hands up, hat off his head.
    "shock": {
        "elbow.L": {"at": (-2.8, -0.5, 5.7)},
        "hand.L": {"at": (-3.3, -0.6, 7.3)},
        "elbow.R": {"at": (2.8, -0.5, 5.7)},
        "hand.R": {"at": (3.3, -0.6, 7.3)},
        "hands": {"L": "open", "R": "open"},
        "hat": {"move": (0, 0, 0.55), "turn": (0, 6, 0)},
    },
}

# What the brows do: (roll in degrees, lift) for the screen-left and the
# screen-right brow. A positive roll raises the inner end.
EMOTIONS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    # One brow cocked, one flat.
    "wry": ((24, 0.06), (0, -0.04)),
    "neutral": ((0, 0), (0, 0)),
    "stern": ((-22, 0), (-22, 0)),
    "worried": ((22, 0.05), (22, 0.05)),
    "skeptical": ((-6, -0.08), (20, 0.18)),
    "surprised": ((6, 0.22), (6, 0.22)),
    "focused": ((-9, -0.1), (-9, -0.1)),
    "suspicious": ((-15, -0.08), (3, -0.06)),
    "happy": ((12, 0.1), (12, 0.1)),
}

# Mr. Fyre

The mascot is a 3D model in `mascot.blend` that is drawn, not lit.

```
mrfyre/model.py       the meshes and the rig
mrfyre/poses.py       the pose, hand-shape and emotion libraries
mrfyre/swing.py       the tie and the coat: weights on springs
mrfyre/scene.py       camera, posing, drawing
mrfyre/motion.py      the moves from one pose to the next
mrfyre/toon_hand.json the hand's mesh, weights and bones
build.py              runs inside Blender: builds the model, draws the sprites
renders/mr-fyre/      transparent PNG sprites + manifest.json
apps/studio           <MrFyre pose="point" emotion="stern" />
```

He is modelled in the round: a ball of a head, a hat with a brim and a crown,
one coat with its collar turned up, sleeves, hands with fingers. He can be
turned to any side and still be drawn. What makes the drawing:

- **No shading.** Nothing lights him. Blender is asked two things about every
  pixel: which part is in front, and how far away it is. Paper parts are filled
  white; ink parts (tie, shoes, mouth, the underside of the brim) black.
- **Line.** A line is drawn wherever two parts meet, wherever a part meets the
  background, and wherever the distance jumps: a sleeve crossing the coat, a
  finger across the palm, the collar standing off the neck. Parts that share a
  `group` in `model.py` — the coat, its collar and its sleeves; the brim and
  the crown — are one shape, so there is no line where a sleeve leaves the
  shoulder, only where the arm passes in front of the body. Folds shorter than
  `SPECK` are left out.
- **Its weight.** `LINE` in `scene.py` is the ordinary weight. Each part says
  how heavy its own outline is (`line=` in `model.py`): the coat's is half as
  heavy again, the hat's a little heavier, the mouth's and the belt's lighter.
  Where two parts meet, the heavier wins; a fold is a little lighter than the
  outline of the part it is in.
- **Cloth.** The collar and the lapels are made the way cloth is: a few flat
  faces laid where the piece goes, a Subdivision Surface modifier that keeps
  the corners, then Solidify for thickness. The collar is a band turned up
  round his neck, low at the throat and high at the back, and it does not
  stand the same on both sides. The hem falls in a few soft folds. The sleeves
  come down over the heels of his hands.
- **How he stands.** `STANCE` in `poses.py` is under every pose: his hips
  forward and to one side, his chest rounded over them, toes turned out, one
  foot forward. His back bends at the `chest` control.
- **Going somewhere.** The poses taken from `assets/generated` — walking,
  running, down on one knee, lunging to point — lean, stride and turn side on.
  Seen from the side his body goes most of the way round and his face stays
  half towards us, so the lenses and the brows are still in the picture. The
  hat leans across the picture with him but never nods towards us.
- **Camera.** It looks level, from chest height and not far away. What is
  below the eye is seen a little from above — the hem curves, the shoes show
  their tops — and what is above it from below: the dark slivers under the brim.
- **Lenses.** Two flat white discs that stand clear of his face, as the lenses
  of a pair of glasses do, with no frame and no eyes behind them. They do not
  bend round his head; when he turns they show past the edge of it. The brim
  always covers their tops.
- **The hat.** It keeps its slant and its two peaks from wherever he is drawn:
  the crown turns to stay square to the camera.
- **Brows.** Two slabs that hang in the air in front of the hat, not on it.
  They are not in the sprites: Blender writes down where they are, and the
  studio draws them, so an emotion is two numbers a brow and one can ease into
  the next.

No Grease Pencil, no Line Art, no textures. In Blender's viewport he is an
ordinary lit 3D model, so his form can be seen and worked on; the flat fill and
the line exist only in the sprites.

## Run it

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py
```

rebuilds the model from the Python and draws every pose. Or open `build.py` in
Blender's Text editor and Run Script. After a `--`: `--render-only` draws the
.blend as it stands, hand edits included; `--only a,b` draws just those poses;
`--scale 2` draws for 4K.

## The coat

Nothing poses it. Besides trailing behind him as he moves (below), it rests
differently according to what he is doing (`swing.py`):

- an arm that lifts takes the coat on its side with it;
- a knee that comes forward pushes its side of the front aside;
- the `trail` control blows it: a pose moves it, and the coat streams that
  way, the back furthest, as it does when he runs;
- it cannot go through the ground: when he crouches it spreads out a little
  and the rest gathers.

## Moves

A cue sheet in the studio changes his pose; a move is the frames in between.
His tie and coat hang from swing bones (`swing.py`): each is a weight on a
spring, so they trail behind him, overshoot and settle. A raised arm takes the
coat on its side with it.

Moves are drawn for the videos that use them and are not committed:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py -- \
  --render-only --moves-for apps/studio/videos/<name>/video.tsx
```

draws every change of `pose:` in that file, in the order they are written.
`--moves "think>point,hips>aside:right"` draws moves by name; `:left` and
`:right` are for a cue that also carries him across the picture, so that the
cloth trails the way he goes. A move takes about half a minute to draw. A move
that has not been drawn is a cut: the video still plays.

## Pose him

In Blender, select `MrFyre.rig` and enter Pose Mode. The bones that point
straight back are the controls:

| Control | What it does |
|---------|--------------|
| `root` | turn all of him, feet included |
| `body` | his hips: move, lean or turn everything above the legs |
| `chest` | bend his back: everything above the waist |
| `hand.*`, `elbow.*` | place an arm; the sleeve stretches to reach and bends at the elbow |
| `aim.*`, `back.*` | where the fingers point, and where the back of the hand faces |
| `foot.*`, `knee.*` | the same for a leg; turning a foot turns its shoe, tipping it lifts the heel |
| `trail` | blow the coat: it streams the way this is pulled, once the cloth is next settled |
| `head`, `hat` | turn, nod and roll; the hat can lift off |
| `brow.*` | roll a brow, and raise it |

Everything that follows the controls is in the rig's hidden `Followers` bone
collection: the limbs, the finger bones (they fold about their own x) and
`tie.*` and `coat.*`, the swing bones, which a pose leaves alone.

Each timeline marker is a pose from the library, held as a keyframe.

To add a pose for the videos, add it to `POSES` in `mrfyre/poses.py` — it says
where the controls go, in the same units you see in Blender ÷ 0.2 — and
rebuild. Hand shapes are `HANDS` in the same file, emotions `EMOTIONS`: a roll
and a lift per brow. All of them appear in the studio, typed, once drawn.

## Credit

The hands are the [Rigged toon hand](https://www.blendswap.com/blends/view/76821)
by marmouille, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
without its glove cuff and on this rig's bones.

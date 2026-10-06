# Mr. Fyre

The mascot is a 3D model in `mascot.blend` that renders like a drawing.

```
mrfyre/model.py       the meshes, the materials and the rig
mrfyre/poses.py       the pose and emotion libraries
mrfyre/scene.py       camera, posing, rendering
build.py              runs inside Blender: builds the model, renders the sprites
renders/mr-fyre/      transparent PNG sprites + manifest.json
apps/studio           <MrFyre pose="point" emotion="stern" />
```

What makes it read as 2D:

- **Shape.** Every part is modelled for its silhouette from the front: the brim
  is a shallow cone because a cone seen edge-on is the wedge in the sketches.
- **No shading.** There are no lights and no materials in the picture. Blender
  is only asked which part is in front at each pixel; paper parts are filled
  white and ink parts (tie, belt, brows, the inside of the coat) black.
- **One line.** A line of one fixed weight (`LINE` in `scene.py`) is drawn
  wherever two parts meet, and where a part meets the background. Parts that
  share a `group` in `model.py` — the hat and its peaks, a palm and its
  fingers — count as one shape, so the line goes round them, never between.
- **Camera.** Orthographic and straight on. There is no perspective to give it away.

No Grease Pencil, no Line Art, no textures. In Blender's viewport he is an
ordinary lit 3D model, so his form can be seen and worked on; the flat fill and
the line exist only in the rendered sprites.

## Run it

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py
```

rebuilds the model from the Python and renders every pose and emotion. Or open
`build.py` in Blender's Text editor and Run Script. `-- --render-only` renders
the .blend as it stands, hand edits included; `-- --scale 2` renders for 4K.

## Pose him

In Blender, select `MrFyre.rig` and enter Pose Mode. The bones that point
straight back are the controls:

| Control | What it does |
|---------|--------------|
| `hand.*`, `elbow.*` | place an arm; the sleeve stretches to reach and bends at the elbow |
| `foot.*`, `knee.*` | the same for a leg |
| `body` | move or lean everything above the legs |
| `head`, `hat` | turn, nod and roll; the hat can lift off |
| `brow.*` | roll and lift a brow |
| `hem.*`, `tie` | swing the coat and the tie |

The hands turn with the forearm but always stay flat to the camera.

Each timeline marker is a pose from the library, held as a keyframe.

To add a pose for the videos, add it to `POSES` in `mrfyre/poses.py` — it says
where the controls go, in the same units you see in Blender ÷ 0.2 — and
rebuild. Emotions are `EMOTIONS` in the same file: a roll and a lift per brow.
Both appear in the studio, typed, once rendered.

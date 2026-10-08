# Studio

Video production for Classifyre, built on [Remotion](https://www.remotion.dev).
It sits in the monorepo for one reason: videos import the product's real
components, theme, fonts, logo and mascot instead of redrawing them, so a video
cannot drift from the UI it shows.

It is not part of the product. The Docker build filters this workspace out of
the install (`--filter '!@classifyre/studio'` in the root `Dockerfile`), so
Remotion never reaches an image.

## Commands

```bash
bun run studio                       # interactive preview (from the repo root or here)
bun run studio:render <id>           # render to apps/studio/out/<id>.mp4
bun run --cwd apps/studio still <id> out/frame.png --frame=90
```

`ReuseCheck` is the built-in composition: a short smoke test made entirely of
`@workspace/ui` components. If it renders correctly, reuse works.

The first render downloads Chrome Headless Shell (~95 MB) into `node_modules`.

## Layout

| Path         | Committed | What it is                                                     |
| ------------ | --------- | -------------------------------------------------------------- |
| `src/kit/`   | yes       | `Stage`, `Viewport`, motion helpers, `Logo`, `Mascot`, `MrFyre` |
| `src/smoke/` | yes       | `ReuseCheck`                                                   |
| `videos/`    | no        | One folder per video: its scenario, its code, its local assets |
| `out/`       | no        | Renders                                                        |

## Making a video

Create `videos/<name>/video.tsx`. Nothing registers it: `src/Root.tsx` reads the
directory, so the file appearing is enough. Keep the scenario beside it as
`videos/<name>/scenario.md`.

```tsx
import { StatsCard } from "@workspace/ui/components/stats-card";
import { defineVideo, Rise, Stage, Viewport } from "../../src/kit";

function Launch() {
  return (
    <Stage theme="dark" grid>
      <Viewport scale={2} className="p-10">
        <Rise delay={10}>
          <StatsCard title="Findings" value="1,284" />
        </Rise>
      </Viewport>
    </Stage>
  );
}

export default defineVideo({
  id: "Launch", // also the output file name
  component: Launch,
  durationInFrames: 150, // 30 fps, 1920x1080 unless overridden
});
```

## Rules that keep renders correct

- **Import, never copy.** Components come from `@workspace/ui/components/*`,
  brand images from `src/kit/brand.tsx`. A component that only exists in
  `apps/web` and is worth filming should move to `packages/ui` first.
- **Wrap every scene in `Stage`.** It supplies the theme class and the font
  variables; without it components render in fallback fonts. Radix overlays
  (dialog, popover, tooltip) portal to `document.body`, outside the `Stage`, and
  lose both — give them a `container` inside it.
- **Use `Viewport` for product UI.** Components are sized for a browser;
  `Viewport` lays them out in a smaller window and magnifies it, so nothing has
  to be restyled to be legible at 1080p.
- **Animate from the frame.** Use the kit's `Rise`, `Pop`, `useEnter`,
  `useCount`, or Remotion's `interpolate`/`spring`. CSS transitions, keyframe
  utilities (`animate-*`) and `:hover` states run on wall-clock time and do not
  render.
- **No wall-clock or random data.** `Date.now()` and `Math.random()` make two
  renders of the same video differ. Use fixed dates and Remotion's `random()`.

## Mr. Fyre

`MrFyre` is the mascot as a presenter: a 3D model that is drawn rather than lit
(`blender/README.md`), shot as sprites the kit reads by itself.

```tsx
<MrFyre pose="point" emotion="stern" height={600} flip />
```

`pose` and `emotion` are whatever `blender/mrfyre/poses.py` defines: standing
ones (`pockets`, `explain`, `think`, …) and ones in which he is going somewhere
(`walk`, `run`, `dash`, `crouch`, `accuse`, …). Poses that point or go
somewhere, point and go to screen right; `flip` mirrors him. `MrFyreActor` takes a cue
sheet instead — which pose and emotion from which frame, and where he stands:

```tsx
<MrFyreActor
  cues={[
    { at: 0, pose: "wave", emotion: "happy", x: 1420, y: 965, height: 760 },
    { at: 90, pose: "point", emotion: "suspicious", x: 300, y: 1010, height: 600 },
  ]}
/>
```

A cue only restates what changes. On a change of pose he moves into it, his tie
and coat swinging after him, when Blender has drawn that move:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b blender/mascot.blend -P blender/build.py -- \
  --render-only --moves-for apps/studio/videos/<name>/video.tsx
```

Moves are keyed by the two poses, not by the frame, so retiming a cue needs
nothing redrawn; a move that has not been drawn is a cut. His brows are drawn
here, not in the sprite, and ease from one emotion to the next. He glides to
wherever a cue moves him; mirroring him with `flip` is always a cut.

He is ink on paper, and the stage is dark: both components put a white edge
round him, the way a sticker is cut, so that his black shoes and outline read.
On a white ground it does not show; `halo={false}` takes it off.

## Fonts

`src/kit/fonts.ts` loads the same four families as
`apps/web/app/[locale]/layout.tsx`. The web app gets them from `next/font`,
which does not exist here, so this list is the one thing the studio restates —
change both together.

## Licence

Remotion is source-available, not OSI open source. It is free for individuals
and for companies of up to three people, commercial use included; larger
companies need a company licence (<https://www.remotion.dev/docs/license>).
Only the free core packages are used here — no Editor Starter, no Lambda.

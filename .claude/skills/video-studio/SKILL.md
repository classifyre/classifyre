---
name: video-studio
description: Make, edit, preview or render a Classifyre product video in the monorepo's Remotion studio (apps/studio). Use whenever asked to turn a scenario, script or storyboard into a video, to animate or film product UI, to change an existing video under apps/studio/videos, or to render/export one. Covers where videos live, how they reuse @workspace/ui components and the product theme, and the rules that keep renders deterministic.
---

# Video studio

`apps/studio` is a Remotion app inside the monorepo so that videos import the
product's real components, theme, fonts, logo and mascot. Read
`apps/studio/README.md` first — it is the committed source of truth for layout,
commands and rules. This file is the working procedure.

For a narrated product video (Mr. Fyre telling a use case, the kind that ends
up on YouTube with a blog post next to it) read `apps/studio/PLAYBOOK.md` as
well, before writing anything: it is the house style and the whole pipeline,
from script and voice to export, subtitles, upload sheet and blog post. Start
from the kit it describes (`Desktop`, `Browser`, `Cursor`, `Camera`,
`AppShell`, `FilmBoard`, `cut`, `Captions`, `Narrator`, `Chip`/`Headline`, and
the paper table in `src/kit/paper`) rather than drawing a laptop, a caption, a
title card or a sheet of paper again, and from the tools in
`apps/studio/tools/` (voice, its two checks, the music bed, subtitles, the
export) rather than writing a one-off script.

For Remotion itself (sequencing, transitions, audio, captions, API lookups) use
the `remotion-best-practices` skill and its references. Where they say to
scaffold a project or run `npx remotion ...`, do not: the project exists, and
the commands here are `bun run studio` / `bun run studio:render <id>`.

For the look of a scene (hierarchy, type, colour, spacing, and the tells of
generic AI design) use the `impeccable` skill: `/impeccable critique` or
`polish` on a still before calling a scene done, and `npx impeccable detect`
on the video's source. Its context files (`PRODUCT.md`, `DESIGN.md`) come from
`/impeccable init`, not from here; the house style in `PLAYBOOK.md` wins where
they differ.

## From scenario to video

1. Save the scenario verbatim as `apps/studio/videos/<name>/scenario.md`.
   `videos/` and `out/` are gitignored on purpose — never `git add -f` them.
2. Break it into scenes with a frame budget each (30 fps). State the budget back
   to the user in one short table before building anything long.
3. Find the real components for what each scene shows:
   `packages/ui/src/components/` first, then `packages/case-board`, then
   `apps/web/components`. Import them. A component that lives only in
   `apps/web` or `apps/blog` and takes everything it needs as props is
   imported where it lives, through `apps/studio/src/borrow/` (its README says
   how). One that fetches its own data or needs the router cannot be: say so,
   and ask before moving its drawing part into `packages/ui`. If the answer is
   to go ahead without that, build the page from the same `@workspace/ui`
   parts with the app's own wording and class names, and list in the hand-over
   which screens were built that way.
4. Write `apps/studio/videos/<name>/video.tsx` default-exporting
   `defineVideo({ id, component, durationInFrames })`. One file per scene once
   there are more than two or three.
5. Open the preview (`studio` configuration in `.claude/launch.json`, or
   `bun run studio`) so the user can watch and steer.
6. Check your own work with stills before saying it is done, and look at them:
   `bun run --cwd apps/studio still <id> out/<id>-<frame>.png --frame=<n>`
   at one frame per scene plus one mid-transition.
7. Render only when asked: `bun run studio:render <id>` → `apps/studio/out/<id>.mp4`.
   For YouTube: `sh apps/studio/tools/youtube.sh <id>` (1080p and 4K, sound
   levelled). After stopping a render by hand, `pkill -9 -f chrome-headless-shell`:
   its browsers outlive it and take the machine with them.

## Rules

- Every scene is wrapped in `Stage` (theme + fonts). Product UI goes inside
  `Viewport` so it is legible at 1080p without restyling.
- Motion comes from the frame. Anything beyond a plain fade or slide is GSAP,
  through the kit: `useTimeline` (a paused timeline seeked to `frame / fps`:
  staggers, sequences, `expo.out` / `back.out` eases) and `tween(frame, start,
  frames, ease)` / `gsapEase(name)` for a single value. Do not hand-roll
  `interpolate` + `Easing` chains or springs for choreography, and never let
  GSAP play on its own ticker (no `gsap.to` outside a `useTimeline`, no
  `ScrollTrigger`, no `repeat: -1` driven by time). `Rise`, `Pop`, `useEnter`
  and `useCount` stay for the simple cases. CSS transitions, `animate-*`
  utilities and hover states do not render.
- 3D is three.js through `@remotion/three`: a `ThreeCanvas` (give it the
  video's `width`/`height`) with react-three-fiber children, driven by
  `useCurrentFrame()`. Use it sparingly, for a moment that earns it (a data
  object turning, a lineage or vector space seen in depth), not as the default
  look. Never `useFrame`, `useThree().clock` or drei's auto-animating helpers:
  they run on wall-clock time. Models and textures load through `staticFile`
  or an import, wrapped by `delayRender`/`useLoader` so a frame waits for them.
  Product UI stays DOM; 3D sits behind or beside it, never redraws it.
- Data is fixed. No `Date.now()`, no `Math.random()`; write the fixture in the
  video file. `packages/ui/src/mocks` is stale in places (lower-case source
  types, dates relative to now) — do not spread it into components unchecked.
- Radix overlays portal outside the `Stage` and lose theme and fonts; pass a
  `container` inside the stage or render the open state inline.
- A motion helper needed by more than one video belongs in `src/kit/`
  (committed); anything specific to one video stays in its folder.
- Check every claim a narration makes against the docs and the code before it
  is spoken, and render a check reel of the whole video before saying it is
  done (`PLAYBOOK.md`, "From scenario to upload").
- After touching `src/`, run `bun run --cwd apps/studio lint` and
  `bun run --cwd apps/studio check-types`, and re-render `ReuseCheck`.

## Licence boundary

Free Remotion core only (`remotion`, `@remotion/cli`, `transitions`,
`google-fonts`, `tailwind-v4`, `three` (with `three`, `@react-three/fiber`), and other free `@remotion/*` packages at the same
pinned version). Do not add Editor Starter or other paid products, and keep all
`@remotion/*` versions identical and exact (no `^`).

---
name: video-studio
description: Make, edit, preview or render a Classifyre product video in the monorepo's Remotion studio (apps/studio). Use whenever asked to turn a scenario, script or storyboard into a video, to animate or film product UI, to change an existing video under apps/studio/videos, or to render/export one. Covers where videos live, how they reuse @workspace/ui components and the product theme, and the rules that keep renders deterministic.
---

# Video studio

`apps/studio` is a Remotion app inside the monorepo so that videos import the
product's real components, theme, fonts, logo and mascot. Read
`apps/studio/README.md` first — it is the committed source of truth for layout,
commands and rules. This file is the working procedure.

For Remotion itself (sequencing, transitions, audio, captions, API lookups) use
the `remotion-best-practices` skill and its references. Where they say to
scaffold a project or run `npx remotion ...`, do not: the project exists, and
the commands here are `bun run studio` / `bun run studio:render <id>`.

## From scenario to video

1. Save the scenario verbatim as `apps/studio/videos/<name>/scenario.md`.
   `videos/` and `out/` are gitignored on purpose — never `git add -f` them.
2. Break it into scenes with a frame budget each (30 fps). State the budget back
   to the user in one short table before building anything long.
3. Find the real components for what each scene shows:
   `packages/ui/src/components/` first, then `packages/case-board`, then
   `apps/web/components`. Import them. If the right component lives only in
   `apps/web`, say so and ask before moving it into `packages/ui`; do not
   rebuild a lookalike in the video.
4. Write `apps/studio/videos/<name>/video.tsx` default-exporting
   `defineVideo({ id, component, durationInFrames })`. One file per scene once
   there are more than two or three.
5. Open the preview (`studio` configuration in `.claude/launch.json`, or
   `bun run studio`) so the user can watch and steer.
6. Check your own work with stills before saying it is done, and look at them:
   `bun run --cwd apps/studio still <id> out/<id>-<frame>.png --frame=<n>`
   at one frame per scene plus one mid-transition.
7. Render only when asked: `bun run studio:render <id>` → `apps/studio/out/<id>.mp4`.

## Rules

- Every scene is wrapped in `Stage` (theme + fonts). Product UI goes inside
  `Viewport` so it is legible at 1080p without restyling.
- Motion comes from the frame: the kit's `Rise`, `Pop`, `useEnter`, `useCount`,
  or `interpolate`/`spring`. CSS transitions, `animate-*` utilities and hover
  states do not render.
- Data is fixed. No `Date.now()`, no `Math.random()`; write the fixture in the
  video file. `packages/ui/src/mocks` is stale in places (lower-case source
  types, dates relative to now) — do not spread it into components unchecked.
- Radix overlays portal outside the `Stage` and lose theme and fonts; pass a
  `container` inside the stage or render the open state inline.
- A motion helper needed by more than one video belongs in `src/kit/`
  (committed); anything specific to one video stays in its folder.
- After touching `src/`, run `bun run --cwd apps/studio lint` and
  `bun run --cwd apps/studio check-types`, and re-render `ReuseCheck`.

## Licence boundary

Free Remotion core only (`remotion`, `@remotion/cli`, `transitions`,
`google-fonts`, `tailwind-v4`, and other free `@remotion/*` packages at the same
pinned version). Do not add Editor Starter or other paid products, and keep all
`@remotion/*` versions identical and exact (no `^`).

# Studio

Video production studio for Classifyre, built on [Remotion](https://www.remotion.dev).

It lives inside the monorepo so product videos import Classifyre's real UI components, theme, fonts, logo, and mascot (Mr. Fyre) instead of redrawing them.

It is not part of the shipped product. The root `Dockerfile` filters it out (`--filter '!@classifyre/studio'`), so Remotion never enters production images.

## Commands

Run these from the repo root:

```bash
bun run studio                       # open the interactive Remotion preview
bun run studio:render <id>           # render to apps/studio/out/<id>.mp4
bun run --cwd apps/studio still <id> out/frame.png --frame=90
```

`ReuseCheck` is the built-in smoke-test composition made of `@workspace/ui` components. If it renders cleanly, UI reuse works.

For narrated videos, use the scripts in `apps/studio/tools/` (run from the repo root):

```bash
bun apps/studio/tools/voice.ts <video-folder>              # generate TTS clips from script.ts
bun apps/studio/tools/hear.ts <video-folder>               # verify spoken words against script.ts
bun apps/studio/tools/stops.ts <video-folder> [--write]    # fit sentence pause indices
sh apps/studio/tools/bed.sh <video-folder>                 # generate a stand-in music bed
sh apps/studio/tools/loop.sh <video-folder> <piece> <sec>  # loop a music track to video length
bun apps/studio/tools/subtitles.ts <video-folder> <id>     # export out/<id>.en.srt + translations
sh apps/studio/tools/youtube.sh <id> [1080p|4k|both]       # export out/<id>-1080p.mp4 and -4k.mp4
```

Read `PLAYBOOK.md` before writing a script or blog post. It covers our data-governance positioning, simple writing style, Mr. Fyre guidelines, audio pipeline, YouTube upload sheet, and EN/DE blog packaging.

The first render downloads Chrome Headless Shell (~95 MB) into `node_modules`.

## Folder layout

| Path | Committed | Purpose |
| --- | --- | --- |
| `src/kit/` | yes | Shared video components and helpers (listed below) |
| `src/borrow/` | yes | Helpers to import prop-driven components from `apps/web` or `apps/blog` (`src/borrow/README.md`) |
| `src/smoke/` | yes | `ReuseCheck` smoke composition |
| `tools/` | yes | Voice generation/checking, music looping, subtitles, YouTube export |
| `PLAYBOOK.md` | yes | Full workflow and style guide for product videos and companion blog posts |
| `videos/` | no | Local video folders (`scenario.md`, scripts, scenes, audio, captures) |
| `out/` | no | Rendered MP4s, stills, and subtitle files |

## Shared kit (`src/kit/`)

`import { … } from "../../src/kit"` provides:

| Exports | Purpose |
| --- | --- |
| `Stage`, `Viewport` | Theme, fonts, background, and browser-scale framing |
| `Rise`, `Pop`, `useEnter`, `useCount` | Frame-driven entrance animations and counters |
| `glide`, `arrive`, `during`, `track`, `typed` | Frame-driven motion, scrolling, and typing helpers |
| `Desktop`, `Window`, `Browser`, `Cursor`, `Camera` | Laptop shell, pointer animation, and camera zoom/pan |
| `useSpots`, `route`, `useOffsets`, `fill`, `useHands` | Measuring targets, routing cursor paths, and typing into inputs |
| `cut`, `captionParts`, `subtitles` | Converting scripts and audio durations into frame timings (`at`, `sentence`, `phrase`, `end`) |
| `Voice`, `Captions`, `Bed`, `MascotNarrator`, `Narrator` | Audio playback, captions, background music, and Mr. Fyre cue-sheet narrators |
| `Chip`, `Headline`, `Mark` | Title cards and callout headings |
| `Logo`, `Mascot`, `Fyre2D`, `Fyre2DActor`, `MrFyre`, `MrFyreActor` | Brand assets, 2D Procreate mascot (default), and legacy Blender presenter |

Three optional modules are imported by their direct path:

- `src/kit/app-shell`: `AppShell` (sidebar and header matching the web app), `T()` for English UI strings, and shared browser window constants (`BROWSER`, `ZOOM`, `PAGE`).
- `src/kit/paper`: paper-on-dark-table components (`Desk`, `Sheet`, `Cutout`, `Print`, `Stamp`, `Tag`, `Panel`, `Marker`, `Marked`, `Thread`, `Pin`, `Stroke`, `Greeking`) for explaining concepts outside the app UI.
- `src/kit/case-board`: `FilmBoard` (wrapper around `@workspace/case-board` with controlled camera for incident-case scenes).

Render toggles: pass `--props='{"captions":false}'` to hide burnt-in captions, or `--props='{"fyre":false}'` to hide Mr. Fyre (useful for clean blog screenshots).

## Creating a video

Create `videos/<name>/video.tsx`. `src/Root.tsx` discovers it automatically. Save the original brief beside it as `videos/<name>/scenario.md`.

```tsx
import { StatsCard } from "@workspace/ui/components/stats-card";
import { defineVideo, Rise, Stage, Viewport } from "../../src/kit";

function GovernanceDemo() {
  return (
    <Stage theme="dark" grid>
      <Viewport scale={2} className="p-10">
        <Rise delay={10}>
          <StatsCard title="Governed assets" value="42" />
        </Rise>
      </Viewport>
    </Stage>
  );
}

export default defineVideo({
  id: "GovernanceDemo", // also the output filename
  component: GovernanceDemo,
  durationInFrames: 150, // 30 fps, 1920x1080 by default
});
```

## Rendering rules

- **Use real UI, do not redraw it.** Import from `@workspace/ui/components/*`, borrow prop-driven components through `src/borrow/`, or capture live app screens with Playwright (`PLAYBOOK.md`, Section 8).
- **Wrap every scene in `Stage`.** It provides the theme class and font variables. Radix overlays (dialog, popover, tooltip) portal to `document.body` outside `Stage` — pass a `container` inside `Stage` or render them inline.
- **Put product UI inside `Viewport`.** It renders components at browser size and scales them cleanly so they remain readable at 1080p.
- **Animate from the frame.** Use `Rise`, `Pop`, `useEnter`, `useCount`, or Remotion's `interpolate`/`spring`. CSS transitions, `animate-*` classes, and `:hover` states do not render reliably.
- **Keep data deterministic.** Never use `Date.now()` or `Math.random()`. Use fixed dates and Remotion's `random()`.

## Mr. Fyre (2D Procreate mascot)

New videos use the hand-drawn 2D Procreate poses in `mascot/poses/*.png` (25 aligned `1200×1200` transparent PNGs with opaque white fill and a crisp 4 px white paper edge — works on dark and light backgrounds with **zero Blender dependency**):

```tsx
<Fyre2D pose="point" height={540} flip />
```

For narrated videos, use `MascotNarrator` (or `Fyre2DActor` directly) with a frame cue sheet:

```tsx
<MascotNarrator
  cues={[
    { at: 0, pose: "wave", x: 1420, y: 965, height: 700 },
    { at: 60, pose: "talk", x: 260, y: 1010, height: 520 },
    { at: 180, pose: "point", x: 260, y: 1010, height: 520 },
    { at: 260, pose: "walk", x: 960, y: 1010, height: 520 },
  ]}
/>
```

Each cue only lists properties that change. `Fyre2DActor` handles smooth gliding, a subtle 2D `spring` squash-and-stretch pop on pose switches (`bounce={false}` disables it), and an automatic 3-frame stride loop for `pose: "walk"`. Use the single `explain` pose while talking (no two-pose talking toggle). Directional poses face screen right; pass `flip` to mirror him, **except `think`** (which has a drawn `?` above his hat and must always stand on the left facing right). See `PLAYBOOK.md` (Section 6) for the full 25-pose table and usage guidelines.

*(Legacy 3D Blender `MrFyre`, `MrFyreActor`, and `Narrator` remain available in `src/kit` for older videos; see `blender/README.md` if you ever need to re-render 3D sprites.)*

## Fonts

`src/kit/fonts.ts` loads the same four font families as `apps/web/app/[locale]/layout.tsx` (without `next/font`). Keep both lists in sync when changing fonts.

## Licence

Remotion is source-available, not OSI open source. It is free for individuals and companies up to three people (including commercial use); larger companies require a Remotion company licence (<https://www.remotion.dev/docs/license>). This workspace uses free core packages only — no Editor Starter, no Lambda.

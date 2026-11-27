---
name: video-studio
description: Make, edit, preview, or render a Classifyre product video in the monorepo's Remotion studio (apps/studio), and prepare its companion YouTube sheet and EN/DE blog post. Use whenever asked to turn a scenario, script, or storyboard into a video, animate or capture product UI, update a video under apps/studio/videos, or render/export one.
---

# Video studio

`apps/studio` is a Remotion app inside the monorepo so videos reuse Classifyre's real UI components, theme, fonts, logo, and mascot (Mr. Fyre).

Read these two files before writing code or copy:

1. `apps/studio/README.md` — layout, commands, kit overview, and rendering rules.
2. `apps/studio/PLAYBOOK.md` — product positioning (data governance), simple/clear writing style, Mr. Fyre voice and visual guidelines, full video pipeline, YouTube packaging, and companion EN/DE blog post guidelines.

## Product focus and tone

Classifyre is a **sovereign data governance platform** (Apache-2.0, self-hosted). Videos and blog posts focus on practical data governance work:

- **Access by organisation:** syncing Entra ID / AD / Keycloak groups, setting roles, row filters, and expiring grants (admins do not get clear data by default).
- **Dynamic column masking:** masking PII inside the query engine (redacted, last four, deterministic hash, empty, hidden) so `WHERE` and `JOIN` cannot leak hidden values.
- **Governed BI, SQL, and AI access:** personal, expiring TLS connections for Power BI, Excel, Tableau, DBeaver, browser SQL workbench, and MCP AI agents — replacing shared passwords and emailed CSVs.
- **Governed data assets, quality, and data products:** owners, stewards, Draft → Certified lifecycle, scheduled quality checks, ODCS v3.2 contracts, live/Delta shared datasets, and usage analytics.
- **Cross-source queries in place:** joining databases, lakehouses, files, search/graph, and custom legacy connectors without migration.
- **Closed-loop leak cases (optional):** used when a topic is specifically about exposed PII, leaked secrets, shadow duplicates, or failing quality rules — not as the default framing for every video.

Writing and narration rules:

- **Keep language simple and clear.** Use short sentences, plain everyday words, and concrete examples. Avoid fancy, poetic, or salesy phrasing.
- **Keep Mr. Fyre as presenter.** Calm, steady, helpful technical guide — not a noir detective running a case.
- **No forced "what it does not do" closer.** Be accurate and transparent (label demo data, verify claims against code and docs), and mention scope only when it actually helps the viewer. End on the practical takeaway or next step.

## Using the kit and Remotion skills

- Reuse `apps/studio/src/kit/` (`Desktop`, `Browser`, `Cursor`, `Camera`, `AppShell`, `FilmBoard`, `cut`, `MascotNarrator`/`Fyre2D`/`Fyre2DActor`, `Chip`/`Headline`, and `src/kit/paper`) instead of rebuilding frames, laptops, or callouts. Prefer `MascotNarrator` (`mascot/poses/*.png`, 25 hand-drawn Procreate poses, zero Blender needed) and check the pose selection guide in `apps/studio/PLAYBOOK.md` (Section 6).
- **No burnt-in captions:** Never render `<Captions>` on video frames; export `.srt` subtitle files (`tools/subtitles.ts`) instead.
- **Mascot rules:** Use the single steady `explain` pose when talking (do not alternate two talking poses; `explain-2` is deleted). Never flip `think` — always place `think` on the left facing right (`flip={false}`) so its drawn `?` above the hat does not mirror backwards.
- **Music tone:** Use warm, upbeat smooth jazz / mellow chords rather than dark or intense drones.
- **Highlight accuracy:** Never guess pixel coordinates for highlight overlays over screenshots — always measure exact pixel positions on the rendered target size and verify every highlight still before full export.
- Reuse `apps/studio/tools/` (`voice.ts`, `hear.ts`, `stops.ts`, `bed.sh`, `loop.sh`, `subtitles.ts`, `youtube.sh`) instead of writing one-off scripts.
- Use `remotion-best-practices` and its sibling `remotion-*` skills for Remotion APIs, timing, transitions, audio, and rendering. Ignore any advice to scaffold a new project or run `npx remotion ...` directly; use `bun run studio` / `bun run studio:render <id>` (or `bun run --cwd apps/studio ...`).

## Workflow: from scenario to video

1. **Save the scenario** verbatim as `apps/studio/videos/<name>/scenario.md`. (`videos/` and `out/` are gitignored — never `git add -f` them.)
2. **Plan the scenes and length.** Break the scenario into scenes with a frame budget (30 fps) and check word count (~140 words/minute with pauses). Share a short scene table with the user before building anything long.
3. **Choose how each screen is built** (in this order):
   - Import directly from `packages/ui/src/components/` (and `packages/case-board` when showing cases).
   - Borrow prop-driven components from `apps/web` or `apps/blog` through `apps/studio/src/borrow/` (see `src/borrow/README.md`).
   - Capture real running app screens with Playwright (`film/shots/capture.mjs`) for read-only or step-by-step workflow pages — fast, zero UI drift, and easy to overlay marks on.
   - Only rebuild a page from `@workspace/ui` + `T()` (`src/kit/app-shell`) when interactive typing or animation inside the page is required (and list those screens in your hand-over).
4. **Create `apps/studio/videos/<name>/video.tsx`** default-exporting `defineVideo({ id, component, durationInFrames })`. Split scenes into `scenes/*.tsx` once there are more than two or three.
5. **Open the preview** (`studio` config in `.claude/launch.json` or `bun run studio`) so the user can review and steer.
6. **Inspect stills and a check reel** before calling the video done:
   - Take stills (`bun run --cwd apps/studio still <id> out/<id>-<frame>.png --frame=<n>`) at the end of each scene plus mid-transition.
   - Render a low-res check reel (`--every-nth-frame=15 --scale=0.25 --muted`) and inspect contact sheets for layout overlaps or errors.
7. **Render when asked:** `bun run studio:render <id>` → `apps/studio/out/<id>.mp4`, or `sh apps/studio/tools/youtube.sh <id> 1080p` first, inspect and check audio levels, then `4k`. If you stop a render manually, run `pkill -9 -f chrome-headless-shell` so stray browser processes do not linger.

## Technical rules

- Wrap every scene in `Stage` (supplies theme and fonts). Put product UI inside `Viewport` so it stays readable at 1080p without restyling.
- Drive all animation from the frame (`Rise`, `Pop`, `useEnter`, `useCount`, `glide`, `interpolate`, `spring`). CSS transitions, `animate-*` classes, and `:hover` states do not render reliably.
- Keep all data fixed and deterministic. Never use `Date.now()` or `Math.random()`. Do not spread stale `packages/ui/src/mocks` unchecked.
- Radix overlays portal outside `Stage` and lose theme/fonts; pass a `container` inside `Stage` or render the open state inline.
- Put helpers shared by multiple videos in `src/kit/` (committed); keep single-video assets and fixtures inside `videos/<name>/`.
- Verify every product claim against both docs and code before generating voiceover.
- After editing anything in `apps/studio/src/`, run `bun run --cwd apps/studio lint`, `bun run --cwd apps/studio check-types`, and re-render `ReuseCheck`.

## Licence boundary

Use free Remotion core packages only (`remotion`, `@remotion/cli`, `@remotion/transitions`, `@remotion/google-fonts`, `@remotion/tailwind-v4`, `@remotion/eslint-plugin`, and other free core packages). Do not add Editor Starter, Lambda, or other paid Remotion products. Keep every `remotion` and `@remotion/*` version identical and exact (no `^`).

# Product video playbook

How a Classifyre product video is made, so that the next one looks and sounds
like the last. `README.md` says what the studio is and what its rules are;
this says how to use it for a narrated walkthrough, from a scenario to a
YouTube upload and a blog post. It was written after the first one, "Leaked
secrets on your laptop" (October 2026), and everything in it was learnt there.

Videos themselves are not committed (`videos/` is ignored). What carries over
from one to the next is the kit in `src/kit/`, the tools in `tools/`, and this
file.

## The form

- **One use case, told as a story.** Open on the viewer's own life (a
  screenshot they forgot), not on the product. The product arrives when the
  viewer has a reason to want it.
- **Mr. Fyre narrates.** A calm investigator: dry, short sentences, no
  superlatives. He explains and points; he does not sell.
- **The product is the real one.** Every screen is built from the product's
  components (see "Where the UI comes from"). What the video draws itself, the
  laptop round the browser and its own notes on the picture, is visibly not
  the product.
- **Useful over flashy.** A viewer should be able to follow along and end up
  with the thing running. Say what it does not do.
- **Three to five minutes**, 1920×1080 at 30 fps.

The arc that worked: cold open (the problem, in the viewer's world) → title
card → install → the steps in the app → the finding that changes the question
→ the investigation → payoff → what the viewer has to do themselves → one
command and where to get it.

## A video's folder

```
videos/<name>/
  scenario.md      what was asked for, verbatim
  script.ts        SCRIPT (scenes of lines), VOICE, SUBTITLES (translations)
  timeline.ts      cut(SCRIPT, clips): frame numbers, nothing else
  audio/           <line id>.mp3, bed.mp3, durations.json, pauses.json
  film/            what only this video needs: its fixtures, its props, its pages
  scenes/          one file a scene
  video.tsx        the scenes in order, with voice and captions over each
  youtube.md       the upload sheet
  .env             OPEN_ROUTER_KEY, for the voice
```

## From scenario to upload

1. **Research before writing.** Read the docs pages for every feature the
   scenario touches, and check the claim in the code when a docs page and the
   UI disagree. Open the running app and walk the flow once: the real page is
   the reference for every screen.
2. **Write `script.ts`.** One line is one breath of narration, a sentence or
   three. `text` is the caption; `say` is the spelling for the voice where it
   differs ("A P I", "dot-env", "localhost, port three thousand").
3. **Speak it**: `bun apps/studio/tools/voice.ts <name>`. One clip a line, and
   `audio/pauses.json` with where the speaker pauses in each.
4. **Cut to the voice.** `timeline.ts` gives `at("line", n)`: the frame, in
   its scene, on which the nth phrase of a line starts. Hang every picture on
   those, never on a number typed by hand. Print the pauses of a line to see
   which phrase is which.
5. **Build scene by scene**, with a still after each
   (`bun run still <Id> out/x.png --frame=<n> --scale=0.5`), and look at it.
6. **Check the whole video** before calling it done: a small reel of every
   15th frame catches a frame that throws.
   `bun run render <Id> out/check.gif --codec=gif --every-nth-frame=15 --scale=0.25`
7. **Draw Mr. Fyre's moves** for the pose changes the video makes
   (`blender/README.md`, `--moves "a>b,…"`), headless.
8. **Export**: `sh apps/studio/tools/youtube.sh <Id>` (1080p and 4K, levelled
   to -14 LUFS). Subtitles: `bun apps/studio/tools/subtitles.ts <name> <Id>`.
9. **Package**: thumbnail, `youtube.md`, and the blog post in both languages
   (below).
10. **Someone listens to it.** The voice and the music are made by machines
    and nothing in this pipeline hears them.

## House style

### The picture

| Thing | Rule |
| --- | --- |
| Frame | 1920×1080, 30 fps. `Stage` round every scene. |
| Laptop | `Desktop` (menu bar with a clock), `Window`, `Browser` from the kit. The clock tells the story's time and must agree from scene to scene. |
| Browser | `BROWSER` and `ZOOM` from `src/kit/app-shell`: one window, 1780×900 at (70, 50), page magnified 1.2. Leave the bottom 130 px of the frame to the captions. |
| Camera | `Camera` with keys `[frame, x, y, zoom]`. Zoom in (1.3 to 1.5) when something is typed or read, back out to 1 before the page changes. Ease over 20 to 30 frames. |
| Pointer | `Cursor` with `route(spots, visits)`. It arrives on the frame it clicks; it leaves 20 to 30 frames earlier. Measure targets with `useSpots`, never by eye. |
| Typing | `typed(text, frame, start, perSecond)`: 12 to 20 a second for things the viewer reads, 30 and up for long things they do not. |
| Scrolling | `useOffsets` for where a section is, `track` to get there. |
| Colour | Black ground, the product's lime (`accent`) for the one thing that matters in a shot. Nothing else is coloured by the video. |

### Words on the picture

- **Captions** are the kit's `Captions`: bottom centre, white on black with a
  lime bar, a sentence or two at a time. They follow the voice's pauses; where
  they guess wrong, name the right pauses in the line's `stops`.
- **Lettering** is the kit's `Chip`, `Headline` and `Mark`: a lime chip in mono
  capitals, a League Gothic headline, one word of it on lime. Title card,
  the question the story turns on, the closing line. Three times a video is
  plenty.
- **The video's own notes on a screen** (a tag on `:ro`, a label over a block
  of the board, an explanation drawn next to a form) are lime tags in mono
  capitals and black panels with a white hairline. They must never look like
  product UI, and a blog post that reuses the frame says they are ours.

### Mr. Fyre

- `Narrator` with a cue sheet. He comes up from below the frame (`y` from
  about 1900 to about 1090) and goes back down; he does not slide in sideways.
- He stands where the picture is empty: over the sidebar (x ≈ 150), or bottom
  right (x ≈ 1750). 430 to 540 px tall over the app, 700 to 760 on a title
  card. If he covers what is being talked about, he is in the wrong place.
- He is there to explain, react or point: about half the video. A scene of
  plain form-filling does not need him.
- Poses that point, point right; `flip` mirrors him. Pick the emotion with the
  pose: `stern` for a warning, `surprised` with `shock`, `wry` by default.
- A pose change plays the move Blender drew for it, about a second. Do not
  change pose more often than that.

### Sound

- Voice: `google/gemini-3.8-flash-tts`, voice `Charon`, with the instruction in
  the first video's `VOICE` (a middle-aged American investigator, calm, dry,
  never an announcer). Keep it for every video: he is one person.
- Clips are levelled to -18 LUFS, the export to -14.
- The bed (`tools/bed.sh`) is a stand-in drone. Replace `audio/bed.mp3` with
  music when there is some.

## Where the UI comes from

In this order:

1. `@workspace/ui` and `@workspace/case-board`: import.
2. A component that lives only in `apps/web` or `apps/blog` and takes all it
   needs as props: import it where it lives, through `src/borrow/web.ts` or
   `src/borrow/blog.ts` (add it there, typed). `src/borrow/README.md` says how.
3. A page that fetches its own data (sources table, findings table, the
   inquiry and case forms, the sidebar): build it from the same `@workspace/ui`
   parts, with the app's own wording (`T("some.key")` from
   `src/kit/app-shell`), the exact class names of the original, and say in the
   hand-over which screens were built this way. Better still, split its drawing
   part into `packages/ui` first.

`AppShell` (`src/kit/app-shell`) is the app round a page. `FilmBoard`
(`src/kit/case-board`) is the case board with the camera in the video's hands.

A component that keeps its own state is driven, not rebuilt: `fill()` types
into its input, `useSpots` finds its buttons.

## Things that break renders

- **Wall-clock motion.** CSS animations, transitions, `setInterval`. Switch
  them off in CSS for the filmed page (`src/kit/desktop.css` does it for the
  landing page) and move things from the frame.
- **React Flow.** It moves its viewport in an effect and measures nodes late.
  `FilmBoard` never moves the viewport and gives every node its size up front.
  Do the same for anything else that measures itself.
- **`at()` out of order.** `track` and `Camera` need rising frame numbers.
  When a line is re-voiced its phrases move; the check reel finds it.
- **A stopped render leaves its browsers behind.** After killing one:
  `pkill -9 -f chrome-headless-shell`.
- **The preview caches the bundler config.** Restart the studio after
  touching `remotion.config.ts`.

## Honesty

- Every claim in the narration is checked against the docs **and** the code.
  (The first video said "close the laptop" over scans running all night. A
  closed laptop sleeps. It was caught late and cost a re-render.)
- Staged data is invented and says so: no real names (not the author's
  either), vendors' documented example keys, obvious placeholders.
- If a detector would not find it, the video does not show it found.
- The video ends on what the tool does not do for you.

## Packaging

### YouTube

- Upload the 4K file. It is the same composition drawn at twice the size, and
  YouTube gives a 4K upload its better codec at every resolution.
- Thumbnail: the title card without captions,
  `bun run still <Id> out/t.png --frame=<n> --props='{"captions":false}'`,
  scaled to 1280×720.
- `youtube.md`: three titles under 75 characters (problem first), a
  description whose first two lines stand alone, the command, chapters from
  the timeline (a chapter is at least ten seconds; merge shorter scenes), 20
  tags, three hashtags, the German title and description, a pinned comment.
- Subtitles: the English file for search, every translation in `SUBTITLES`.

### Blog

- A post in `apps/blog/app/(en)/blog/articles/<slug>/page.mdx` and its German
  twin in `app/(de)/de/blog/articles/<slug>/page.mdx`, both added to the two
  `_meta.js` files. Copy the frontmatter of the last one.
- Screenshots are stills of the video at twice the size without captions or
  Mr. Fyre: `--scale=2 --props='{"captions":false,"fyre":false}'`, cropped to
  the browser window (`140 100 3560 1800` at that size) and saved as WebP,
  2160 wide, quality 86, under `public/blog/assets/images/` with names that
  say what is on them.
- The cover is 1952×1098 with its left third dark: the title is set over it.
- A few seconds of the video as a silent looping MP4 (`--frames=a-b --muted`,
  cropped, 1280 wide, CRF 25) where a still cannot show it: something growing
  or emptying.
- The post is published before the video and stands without it. It says the
  laptop is staged, and it has a section on what the tool does not do.

## Still to do

- Extract the drawing parts of the sources table, findings table, inquiry
  form and new-case page into `packages/ui`, so that videos film them instead
  of rebuilding them.
- Real music.

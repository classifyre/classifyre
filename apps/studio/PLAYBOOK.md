# Product video playbook

How a Classifyre product video is made, so that the next one looks and sounds
like the last. `README.md` says what the studio is and what its rules are;
this says how to use it for a narrated film, from a scenario to a YouTube
upload and a blog post. It was written after the first one, "Leaked secrets on
your laptop", and revised after the second, "Before you sign" (both October
2026). Everything in it was learnt on one of the two, mostly by getting it
wrong first.

Videos themselves are not committed (`videos/` is ignored). What carries over
from one to the next is the kit in `src/kit/`, the tools in `tools/`, and this
file.

## The form

- **One use case, told as a story.** Open on the viewer's own life (a
  screenshot they forgot, a contract they sign on Friday), not on the product.
  The product arrives when the viewer has a reason to want it.
- **Mr. Fyre narrates.** A calm investigator: dry, short sentences, no
  superlatives. He explains and points; he does not sell.
- **The product is the real one.** Every screen is built from the product's
  components (see "Where the UI comes from"). What the video draws itself, the
  laptop round the browser and its own notes on the picture, is visibly not
  the product.
- **Useful over flashy.** A viewer should be able to follow along and end up
  with the thing running. Say what it does not do.
- **Three to five minutes**, 1920×1080 at 30 fps. A showcase with several
  cases runs longer (the second is 6:30). Decide the length from the word
  count before a line is spoken, not from the first cut.

Two arcs have worked.

A walkthrough: cold open (the problem, in the viewer's world) → title card →
install → the steps in the app → the finding that changes the question → the
investigation → payoff → what the viewer has to do themselves → one command
and where to get it.

A showcase of a live workspace: cold open → title card → what the data is →
the sources in the app → the research finding that shaped the rules → the
detectors, each tied to a question → glossary and entities → a notice of what
is invented → the cases, one invented example each → that it is live → what
it will not tell you → where to open it.

## A video's folder

```
videos/<name>/
  scenario.md      what was asked for, verbatim
  research.md      every figure the film says or shows, and where it was measured
  script.ts        SCRIPT (scenes of lines), VOICE, SUBTITLES (translations)
  timeline.ts      cut(SCRIPT, clips): frame numbers, nothing else
  audio/           <line id>.mp3, bed.mp3, durations.json, pauses.json
  audio/takes/     what the voice model said before its pauses were shortened; music sources
  film/            what only this video needs: its fixtures, its props, its pages
  film/photos/     cut-out photographs and their outlines (cuts.json)
  scenes/          one file a scene
  video.tsx        the scenes in order, with voice and captions over each
  youtube.md       the upload sheet
  .env             OPEN_ROUTER_KEY, for the voice
```

## From scenario to upload

1. **Research before writing.** Read the docs pages for every feature the
   scenario touches, and check the claim in the code when a docs page and the
   UI disagree. Open the running app and walk the flow once: the real page is
   the reference for every screen. Take a screenshot of every page the film
   will show and keep it open while building. Write the figures down in
   `research.md` as they are measured (see "A film about a live workspace").
2. **Write `script.ts`.** One line is one breath of narration, a sentence or
   three. `text` is the caption; `say` is the spelling for the voice where it
   differs ("A P I", "dot-env", "localhost, port three thousand"). **Count the
   words first.** He speaks about 150 words a minute, and with the gaps that
   is 140 words a minute of film: 900 words are six and a half minutes. The
   second video was written to 980, came out at 6:57, and 23 lines were paid
   for twice.
3. **Speak it**: `bun apps/studio/tools/voice.ts <name>`. One clip a line, and
   `audio/pauses.json` with where the speaker pauses in each. Naming lines
   does not make it a trial run: every line that has no clip yet is spoken,
   named or not. Then check what was said (see "Sound").
4. **Cut to the voice.** `timeline.ts` gives `at("line", n)`: the frame, in
   its scene, on which the nth phrase of a line starts. Hang every picture on
   those, never on a number typed by hand. A phrase is whatever lies between
   two pauses, so `n` is not the sentence number: the second video's
   `timeline.ts` adds `sentence(id, n)`, which reads the line's `stops`, and
   that is the one to hang pictures on.
5. **Build scene by scene**, with stills after each, and look at them:
   `bun run still <Id> out/x.png --frame=<n> --scale=0.5`. Several can run at
   once. Take them where everything is on screen (the end of a scene's last
   line), not in the middle of an entrance: that is where things collide.
6. **Check the whole video** before calling it done. Render every 15th frame
   small, then lay the frames out as contact sheets and read them: a frame
   that throws stops the render, and a sheet shows the layout faults a GIF
   plays past.
   ```bash
   bun run render <Id> out/check.mp4 --every-nth-frame=15 --scale=0.25 --muted
   ffmpeg -i out/check.mp4 -vf "select='not(mod(n\,4))',scale=384:216,tile=7x7" -vsync 0 out/sheet-%02d.jpg
   ```
7. **Mr. Fyre's moves.** Choose pose changes from the moves already drawn
   (`ls blender/renders/mr-fyre/moves`) and nothing has to be rendered. Only a
   change that is not there needs Blender (`blender/README.md`,
   `--moves "a>b,…"`, headless).
8. **Export in two steps.** `sh apps/studio/tools/youtube.sh <Id> 1080p`
   first; tile it into sheets (`fps=1/2.5,scale=480:270,tile=6x6`), read them,
   measure the sound (`-af ebur128`), fix what they show. Only then
   `youtube.sh <Id> 4k`. Six and a half minutes took 12 minutes at 1080p and
   35 at 4K; the second video started both at once three times and threw two
   of the runs away. Subtitles:
   `bun apps/studio/tools/subtitles.ts <name> <Id>`.
9. **Package**: thumbnail, `youtube.md`, and the blog post in both languages
   (below).
10. **Someone listens to it.** The voice and the music are made by machines.
    A model can check the words (see "Sound"), and nothing in this pipeline
    hears how it sounds.

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
| Colour | Black ground, the product's lime (`accent`) for the one thing that matters in a shot. Nothing else is coloured by the video. Paper and photographs are off-white and black. |

### Words on the picture

- **Captions** are the kit's `Captions`: bottom centre, white on black with a
  lime bar, a sentence or two at a time. They follow the voice's pauses; where
  they guess wrong, name the right pauses in the line's `stops`.
- **Lettering** is the kit's `Chip`, `Headline` and `Mark`: a lime chip in mono
  capitals, a League Gothic headline, one word of it on lime. Title card,
  the question the story turns on, the closing line. Three times a video is
  plenty for a walkthrough; a showcase also letters each case's question and
  the one sentence each part leaves behind.
- **The video's own notes on a screen** (a tag on `:ro`, a label over a block
  of the board, an explanation drawn next to a form) are lime tags in mono
  capitals and black panels with a white hairline. They must never look like
  product UI, and a blog post that reuses the frame says they are ours.
- **Mono capitals are wide.** With their tracking a stamp or a tag takes about
  0.8 of its type size a character, and a stamp lands at nearly twice its size
  before it settles. Work the width out before placing one near an edge: two
  stamps ran off the frame and one tag sat on the board's toolbar.

### The table

The second video's look for everything that is not the product: paper on a
black table. It is in `videos/firmenbuch-austria/film/paper.tsx` (`Desk`,
`Sheet`, `Cutout`, `Stamp`, `Tag`, `Panel`, `Marker`, `Thread`, `Pin`,
`Stroke`, `Provenance`), not yet in the kit.

- Sheets lie a degree or two off straight and are put down from the frame
  (`put()`), with a drop shadow on a wrapper: `clip-path` on an element clips
  its own shadow.
- **Photographs are cut out with scissors, not masked.** Ask the image model
  for one object, complete and centred, as a black-and-white archival press
  photograph on a white seamless ground (`google/gemini-3-pro-image` through
  OpenRouter's chat completions with `modalities: ["image", "text"]`; the
  picture comes back as a data URL in `message.images`). Removing the ground
  by flood fill fails: it stops at a grey vignette and eats glass and other
  light parts. Keep the white ground instead and cut a few straight snips
  round the object: ImageMagick's convex hull of the dark pixels, grown by
  four percent, as a `clip-path` polygon in `photos/cuts.json`.
  ```bash
  magick in.png -colorspace Gray -level 4%,82% -blur 0x3 -threshold 58% \
    -morphology Open Disk:6 -shave 8x8 -bordercolor white -border 8 \
    -define convex-hull:background-color=white -format "%[convex-hull]" info:
  ```
  Without the blur and the strict threshold the hull is the whole picture:
  the grey in the corners counts as part of the object.
- A cut-out goes at a sheet's corner, clear of its title. Two of them
  covered the name of the company they were illustrating.
- A paper form that looks official (a register extract) says "Illustration"
  on it. The film does not imitate a court's or an authority's own document.

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
  change pose more often than that. Going down and coming up somewhere else
  is a cut and needs no move; so is `flip`, so set it on the cue he comes up
  with, not on a later one.

### Sound

- Voice: `google/gemini-3.8-flash-tts`, voice `Charon`. Keep both, and this
  instruction, for every video: he is one person.

  > A middle-aged American man with a deep, calm voice: a seasoned private
  > investigator talking a client through a case. Dry and understated, warm
  > but serious. A steady conversational pace that keeps moving: one sentence
  > follows the next closely, with only a brief breath between them and no
  > long pauses. Clear diction. Never theatrical, never an announcer.

  Add what the script needs and nothing else ("German company names are said
  the German way").
- Clips are levelled to -18 LUFS, the export to -14.
- **Pace** is set in two places. The instruction tells him to keep moving, and
  `VOICE.maxPause` (0.34) has `tools/voice.ts` shorten every longer silence to
  about that: the model still leaves up to a second between sentences. What
  the model said is kept in `audio/takes/`, so `--recut` tries another value
  without speaking again. Between scenes, a `tail` and a `lead` of 12 to 14
  frames each is a breath; more is a hole. Measure it, do not judge it: the
  longest pause in `audio/pauses.json` was 1.02 s in the first video and 0.47 s
  in the second.
- **Stops.** Once pauses are that even, the captions can no longer tell a full
  stop from a comma by length. Give every line of more than one sentence its
  `stops`. The pauses to name are the ones that fall where the sentences end
  if speech ran at an even rate: a sentence's share of the line's characters
  is its share of the line's time. Re-voicing a line moves its pauses, so its
  `stops` are worked out again each time. Where `say` breaks a sentence in two
  for the voice, count the sentences of `text`: that is what the captions
  show.
- **What the voice gets wrong**, and what fixed it:
  - A name the model has never seen. "Mr. Fyre" is said "Mister Fire" in
    `say`. An invented German name that opens a sentence gets swallowed; give
    it a plain word to lean on ("Then Mondkogel Consulting files…").
  - A short clause after a colon is run into the next sentence. Make it a
    sentence of its own in `say`.
  - Figures. Write them out in `say`; keep the digits in `text`.
  - A stray "mm" or a changed word. Speak the line again.
  - Every line is its own take. A line spoken again later can sound like a
    different afternoon; if it stands out, speak it once more.
- **Check the words by machine.** Send each clip to a model that takes audio
  (`google/gemini-3.8-flash`, a `{type: "input_audio", input_audio: {data,
  format: "mp3"}}` part in a chat completion) and ask for a word-for-word
  transcript with numbers as words; compare it with `say`, case and
  punctuation aside. It finds dropped, added and changed words. It mishears
  brand names and invented names every time, and it cannot time anything: it
  reported pauses of two seconds where the file has 0.4.
- **Music.** `tools/bed.sh` makes a stand-in drone. The second video's bed is
  a generated noir-jazz trio, which suits a man in a trench coat:
  `google/lyria-3-pro-preview` through OpenRouter (audio output needs
  `stream: true`; about three minutes a piece, the `clip` model gives thirty
  seconds). Say the mood, the key and what must not happen (no lead, no
  vocals, no build-up, no big ending): the first try, asked only to be calm,
  came back as an uplifting steel drum. Have an audio model describe a piece
  before using it: instruments, where the energy changes, where it ends. Loop
  it with five-second crossfades, cutting each pass before the piece's own
  ending and letting the last pass run into it; dip 2 kHz by 4 dB; level to
  -30 LUFS; play it at 0.55. The bed is exactly as long as the video, so it is
  made again whenever a line is.

## Where the UI comes from

In this order:

1. `@workspace/ui` and `@workspace/case-board`: import.
2. A component that lives only in `apps/web` or `apps/blog` and takes all it
   needs as props: import it where it lives, through `src/borrow/web.ts` or
   `src/borrow/blog.ts` (add it there, typed). `src/borrow/README.md` says how.
3. A page that fetches its own data (sources table, findings table, the
   detectors and glossary tables, the inquiry and case forms, the case page
   round its board, the sidebar): build it from the same `@workspace/ui`
   parts, with the app's own wording (`T("some.key")` from
   `src/kit/app-shell`), the exact class names of the original, and say in the
   hand-over which screens were built this way. Better still, split its drawing
   part into `packages/ui` first.

A rebuilt page has the real page's columns and no others. Put it next to the
screenshot from step 1 before exporting. The second video's Sources table had
a "Records" column the product does not have; it was found after the first
full export.

Where the live page shows a fault (a raw translation key for a label), the
film shows what the dictionary says it should, and the fault is reported.

`AppShell` (`src/kit/app-shell`) is the app round a page. `FilmBoard`
(`src/kit/case-board`) is the case board with the camera in the video's hands.
Its drawing covers board coordinates -120 to 3000 across and -150 to 1030
down: three frames of 900 with 60 between them fit. Give every record a place
that does not depend on which others are there, or the board shuffles when
one leaves.

A component that keeps its own state is driven, not rebuilt: `fill()` types
into its input, `useSpots` finds its buttons. `useSpots` measures where things
are on screen, camera included, so whatever is drawn from a spot (a thread, a
tag) is drawn outside the `Camera`.

## A film about a live workspace

- **Freeze the figures on one day and say which.** A workspace that scans
  keeps moving. Research three days old had the workspace at a sixth of its
  size, and every tally in it had moved. Count again on the day,
  put every figure in `research.md` with how it was measured, show the date
  next to the figures on screen, and have the narration say "on the day we
  filmed".
- **Count, do not quote.** Notes and tallies stored in the workspace can be
  older than its data. Recount with read-only queries, and check what a table
  holds before counting from it (scan runs are pruned; records carry the day
  they were created). Do not hide a query's errors: a count that silently did
  not run looks like a count.
- **Real companies are not flagged on screen.** A case is told with an
  invented company, with invented figures that the rule would in fact flag
  (work the arithmetic through: a company that "leaves" has to fall below the
  threshold). The counts and the results are the workspace's own.
- **Three labels, the same all through**: real (a count from the live
  workspace), invented (a company, its number, its figures), hypothesis (a
  claim still being tested). A short scene before the cases says which is
  which, and every later screen carries the label.
- **An invented name is searched in the real register**, all of it, not in
  the workspace and not on the web. One name passed both and was a registered
  company. The names, the date and the search go in `research.md`.
- **Say only what the data read can say.** "The register does not name
  owners" was false; "the records we read name managers, not owners" is true.

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
- **A render films the code as it was when it started.** An edit made while
  one runs is not in it.
- **Something hidden with opacity still takes its room.** A list whose rows
  arrive one by one leaves a hole where the next will be; leave the row out
  until it is due.

## Things that cost time

- `bun run lint` needs Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`). Under
  an older Node, ESLint dies with "ReadableStream is not defined", which
  reads like a broken install.
- In zsh a pattern that matches nothing (`rm -f out/review/*.jpg` in an empty
  folder) stops the whole command line, and what came after it never ran.
- ImageMagick's `montage` wants a font and fails without one. Join stills with
  `magick \( a.png b.png +append \) \( c.png d.png +append \) -append`.
- The showcase's REST paths end in a slash; without it the answer is a 308.

## Honesty

- Every claim in the narration is checked against the docs **and** the code.
  (The first video said "close the laptop" over scans running all night. A
  closed laptop sleeps. It was caught late and cost a re-render.)
- Staged data is invented and says so: no real names (not the author's
  either), vendors' documented example keys, obvious placeholders.
- If a detector would not find it, the video does not show it found. A
  finding shown for an invented company is worded the way the detector words
  its own.
- A section of a law is looked up in the law, not copied from the last post.
  (The blog draft cited § 242 UGB for what § 278 says.)
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
  For a showcase the description also says what is invented and the day the
  figures are from.
- Subtitles: the English file for search, every translation in `SUBTITLES`.
  A translated line has as many sentences as the original; the tool warns
  when one does not.

### Blog

- A walkthrough is a post in `apps/blog/app/(en)/blog/articles/<slug>/page.mdx`
  with its German twin in `app/(de)/de/blog/articles/<slug>/page.mdx`; a
  showcase is a case file under `blog/cases/` in the same two trees. Both go
  into the two `_meta.js` files of their section: a post can exist and be
  missing from the menu. Copy the frontmatter of the last one, and check that
  the cover it names is there.
- Screenshots are stills of the video at twice the size without captions or
  Mr. Fyre: `--scale=2 --props='{"captions":false,"fyre":false}'`, cropped to
  the browser window (`140 100 3560 1800` at that size) and saved as WebP,
  2160 wide, quality 86, under `public/blog/assets/images/` with names that
  say what is on them.
- The cover is 1952×1098 with its left third dark: the title is set over it.
  A still at `--scale=1.0167` is that size.
- A few seconds of the video as a silent looping MP4 (`--frames=a-b --muted`,
  cropped, 1280 wide, CRF 25) where a still cannot show it: something growing
  or emptying.
- The post is published before the video and stands without it. It says what
  is staged or invented, and it has a section on what the tool does not do.
- A post that quotes figures is frozen on the same day as the film. When the
  film recounts, so does the post, in both languages.
- Compile both posts before handing over (`compile` from the repo's
  `@mdx-js/mdx`, on the file without its frontmatter): a stray brace in MDX
  breaks the site's build, not the studio's.

## Still to do

- Extract the drawing parts of the sources table, findings table, inquiry
  form and new-case page into `packages/ui`, so that videos film them instead
  of rebuilding them. The second video added the detectors table, the
  glossary table and the case page to that list.
- Three checks were scripts written for one video and thrown away: printing
  the cut (scenes, lines, phrases as frames), fitting each line's `stops`,
  and transcribing every clip against the script. They belong in `tools/`.
- `tools/voice.ts` speaks every line that has no clip; it has no way to speak
  only the lines it is given.
- `sentence()` and `phrase()` are in the second video's `timeline.ts`, and the
  paper table is in its `film/paper.tsx`. Both move to the kit when a third
  video wants them.
- Music a person chose.

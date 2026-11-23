# Product video and blog playbook

This playbook explains how to make a narrated Classifyre product video and its companion blog post, from initial idea to YouTube upload and published EN/DE article.

`README.md` covers studio setup, commands, and rendering rules. This file covers product positioning, writing style, Mr. Fyre, audio, visuals, YouTube packaging, and blog posts.

Videos themselves are not committed (`videos/` is gitignored). Shared components live in `src/kit/`, scripts live in `tools/`, and shared rules live here.

---

## 1. Product focus: data governance first

Classifyre is a **self-hosted, open-source (Apache-2.0) data governance platform**. It sits between the data systems and identity directories an organisation already runs and the tools its teams use — without migrating data into a new warehouse.

Build videos and blog posts around these core topics:

1. **Access follows your organisation.** Sync groups from Entra ID, Active Directory, Okta, or Keycloak. Control who can read which sources, tables, rows, and columns with role grants, row filters per department/region, and expiring access. Admins do not get clear sensitive data by default.
2. **Dynamic column masking inside the query engine.** Classify sensitive data in place (41+ PII types, 27 secret patterns, custom Python/regex/local AI rules) and enforce 5 masking modes (redacted, last four, deterministic salted hash, empty, hidden) inside the query engine so `WHERE` and `JOIN` cannot leak hidden values.
3. **Governed BI, SQL, and AI access.** Give analysts and tools personal, expiring TLS connections to Power BI, Excel, Tableau, DBeaver, ODBC, the built-in browser SQL workbench, and AI agents via MCP — replacing shared database passwords and emailed CSV exports.
4. **Governed data assets, quality, and data products.** Assign owners, stewards, and custodians; run scheduled quality checks across 7 ODCS dimensions; move assets from `draft` to `active` (certified); export and import ODCS v3.2 YAML contracts; publish live or Delta-backed shared datasets where source masks stay enforced as a strict floor; track live reads, exports by format, and policy diffs.
5. **Cross-source SQL without migration.** Query across PostgreSQL, MySQL, Oracle, MSSQL, Iceberg, Delta, Parquet, S3/Azure/GCS, search/graph engines, and custom legacy APIs in one place.
6. **Closed-loop leak remediation (optional use case).** When a topic is specifically about exposed PII, leaked secrets, shadow CSVs, or failing quality checks auto-opening findings and cases, show the findings queue and case workflow — as one capability of the governance platform, not the headline of every video.

### Words to use (and words to avoid)

Use clear terms that IT leads, data teams, DPOs, and CISOs actually search for:

| Idea | English | German |
| --- | --- | --- |
| Category | data access governance, self-hosted data governance | Datenzugriff steuern, Zugriffssteuerung, Data-Governance-Plattform |
| Org permissions | access by role, permissions model, row filter | Berechtigungskonzept, Rollen- und Rechtekonzept, Zeilenfilter |
| Masking | dynamic data masking, column masking, pseudonymisation | Datenmaskierung, Pseudonymisierung, Datenminimierung |
| Data products | shared dataset, data product, self-service analytics | Datenprodukt, geteilter Datensatz, Self-Service-Analytics |
| Audit | audit trail, access log, accountability | Protokollierung, Nachvollziehbarkeit, Rechenschaftspflicht |
| Deployment | self-hosted, on-premises, no vendor lock-in | selbst betrieben, On-Premises, im eigenen Rechenzentrum, Datensouveränität |
| Regulation | supports GDPR / NIS2 / EU AI Act | unterstützt DSGVO / NIS2 / EU AI Act *(never claim legal certification)* |

Avoid outdated or confusing phrasing:

- Do not lead with "PII scanner" or "secrets scanner" — discovery is how masking and governance know what to protect.
- Do not say "query everything" — say "query the data you are allowed to see".
- Do not call Classifyre an investigation tool by default — investigation and leak cases are one use case on top of the governance platform.
- Keep "shared dataset" as the UI/docs term and explain "data product" right beside it when used in headlines.

---

## 2. Writing style: simple, clear, direct

Keep every script, caption, YouTube description, and blog post easy to read and easy to listen to:

- **Short sentences.** One idea per sentence. Split long multi-clause sentences into two.
- **Plain everyday words.** Prefer "show" over "surface", "check" over "interrogate", "use" over "leverage", "rules" over "policy constructs".
- **Active voice.** Say "Classifyre masks the IBAN column before the query runs", not "Masking is applied to the IBAN column".
- **Concrete examples.** Show a real table name (`crm.kunden`), a real role (`Regional Analyst — Graz`), and a real result instead of abstract claims.
- **No fancy or poetic phrasing.** Write like a clear colleague explaining a practical system, not like a literary essay or a sales brochure.
- **No hype or superlatives.** Skip "revolutionary", "seamless", "game-changing", "enterprise-grade". Let the working product prove the point.
- **Explain jargon once.** If you mention ODCS, MCP, or deterministic hashing, define it in one short sentence the first time.
- **No forced "what it does not do" ending.** Earlier investigation videos always ended with a long disclaimer about what the tool cannot answer. Drop that habit. Be honest and accurate throughout, mention scope boundaries naturally when they actually help the viewer (for example, "Classifyre reads groups from your existing Entra ID — it does not replace your identity provider"), and end on the practical takeaway or next step.

---

## 3. Video formats

Most videos are **3 to 5 minutes** (1920×1080 at 30 fps). Deep explainers or multi-role demos can run 5 to 7 minutes. Decide the length from word count before generating voice (~140 spoken words per minute including pauses, so 550–700 words ≈ 4–5 minutes).

Pick the format that fits the topic:

1. **Feature walkthrough (3–5 min):**
   Start with a real workplace problem (waiting weeks for a CSV export, sharing a database password, blocking Power BI because of PII) → title card → quick setup or live workspace → step-by-step in the app (connect source, map groups/row filters/masks, run a query in the workbench or connect Power BI/MCP, view the audit log) → practical result → how to try it (Docker command, docs, or live showcase).
2. **Role-based scenario — "same table, different people" (4–6 min):**
   Start with a concrete organisation scenario (for example, a municipal utility or mid-market company with demo data, clearly labeled as demo data) → title card → the access rule written on paper vs. what happens in practice → switch between 2–3 roles on the same data (regional analyst sees own district with masked IBANs; finance steward sees cleared values; admin still sees masked values; DPO checks the access log and policy diff) → summary and link to `showcase.classifyre.com` or docs.
3. **Concept explainer (4–7 min):**
   Start with one clear, everyday data problem → title card → plain explanation using one worked example (for example, why output-only masking leaks via `WHERE`, how lakehouse deletes leave files behind, what an ODCS data contract contains) → why it matters for teams → brief demo in Classifyre (3–4 screens, 20–40 seconds) → key takeaway and link to the blog post.
4. **Live workspace showcase or leak case (5–7 min):**
   Use when touring a live `showcase.classifyre.com` workspace or covering an incident-response / leak-remediation scenario (exposed PII, leaked secrets, shadow duplicates, or a failing quality rule opening a finding and case). Clearly label demo/invented data and freeze live numbers to a specific date.

---

## 4. Video folder layout

```text
apps/studio/videos/<name>/
  scenario.md      original request, saved verbatim
  research.md      verified figures, dates, and code/docs checks
  script.ts        SCRIPT (scenes and lines), VOICE, SUBTITLES (translations)
  timeline.ts      cut(SCRIPT, clips) — frame timings derived from audio
  audio/           <line-id>.mp3, bed.mp3, durations.json, pauses.json
  audio/takes/     untrimmed voice takes (.flac) and source music files
  film/            video-specific fixtures, props, capture scripts, pages
  film/photos/     cut-out photos and outlines (cuts.json)
  scenes/          one file per scene
  video.tsx        scenes in order, with voice, captions, and background bed
  youtube.md       upload sheet (titles, description, chapters, tags, DE copy)
  .env             OPEN_ROUTER_KEY for voice generation and checking
```

---

## 5. Step-by-step workflow

1. **Verify the product before writing.** Read the docs for every feature you will show, and check the actual code if docs and UI differ. Walk through the flow in the running app once and take reference screenshots of every page. Record exact numbers and dates in `research.md`. Fix real UI bugs before filming rather than filming around them.
2. **Write `script.ts`.** Each line is 1 to 3 short sentences. `text` is the caption; `say` is the pronunciation spelling when needed (`"A P I"`, `"I B A N"`, `"localhost, port three thousand"`, `"Mister Fire"`). Count total words before generating audio (~140 words/min).
3. **Generate voiceover:**
   ```bash
   bun apps/studio/tools/voice.ts <name>
   ```
   This creates one `.mp3` per line plus `audio/durations.json` and `audio/pauses.json`. Note: every unvoiced line is generated unless you pass `--only <line-id>` for a trial run.
4. **Verify speech and fit sentence stops:**
   ```bash
   bun apps/studio/tools/hear.ts <name>
   bun apps/studio/tools/stops.ts <name> --write
   ```
   Review any mismatched words from `hear.ts` and quickly scan the `stops` written into `script.ts` (especially short lines with commas).
5. **Time visuals to the voice.** Use `timeline.ts` helpers — `sentence(id, n)` for sentence boundaries, `phrase(id, n)` or `at(id, n)` for pauses, and `within(id, share)` when a sentence has no internal pauses (`TOO FEW PAUSES`). Never hardcode frame numbers by hand. Unvoiced lines fall back to an even estimate, so you can lay out scenes before generating audio (skip `<Voice>` on unvoiced lines using a small `spoken()` helper).
6. **Build scene by scene and inspect stills:**
   ```bash
   bun run --cwd apps/studio still <Id> out/scene-01.png --frame=<n> --scale=0.5
   ```
   Take stills at the end of each scene (when all elements are settled on screen, not mid-scroll or mid-fade) to catch overlaps early.
7. **Run a full-video check reel:**
   ```bash
   bun run --cwd apps/studio render <Id> out/check.mp4 --every-nth-frame=15 --scale=0.25 --muted
   ffmpeg -i apps/studio/out/check.mp4 -vf "select='not(mod(n\,4))',scale=384:216,tile=7x7" -vsync 0 apps/studio/out/sheet-%02d.jpg
   ```
   Read every contact sheet. This catches runtime errors, clipping, overlaps, and layout stalls across the whole video.
8. **Pick Mr. Fyre poses from `mascot/poses/`.** Use `MascotNarrator` (`Fyre2DActor`) from `src/kit` — all 26 hand-drawn Procreate poses work directly with no Blender rendering required (see the pose guide below).
9. **Export in two steps:**
   - First render 1080p: `sh apps/studio/tools/youtube.sh <Id> 1080p`.
   - Inspect contact sheets (`fps=1/2.5,scale=480:270,tile=6x6`) and check loudness (`ffmpeg -i ... -af ebur128 -f null -`). Fix anything broken.
   - Only after 1080p is clean, render 4K: `sh apps/studio/tools/youtube.sh <Id> 4k`.
   - Generate subtitles: `bun apps/studio/tools/subtitles.ts <name> <Id>`.
10. **Package and listen.** Create the thumbnail, `youtube.md`, and EN/DE blog posts (Section 10). Always have a human listen to the final export — automated tools check words and loudness, not delivery or music balance.

---

## 6. Visual style

### Screen layout and camera

| Element | Standard |
| --- | --- |
| Frame | 1920×1080, 30 fps. Wrap every scene in `Stage`. |
| Laptop frame | `Desktop` (menu bar clock consistent across scenes), `Window`, `Browser` from `src/kit`. |
| Browser window | `BROWSER` and `ZOOM` from `src/kit/app-shell`: 1780×900 at `(70, 50)`, page magnified `1.2`. Keep the bottom 130 px clear for burnt-in captions or YouTube subtitles. |
| Address bar | Show the public host (`classifyre.com/<workspace>/…` or `showcase.classifyre.com/…`), never `localhost`. |
| Camera | `Camera` with rising keyframes `[frame, x, y, zoom]`. Zoom in (`1.3`–`1.5`) when typing or reading a detail; zoom back to `1` before switching pages. Ease over 20–30 frames. |
| Pointer | `Cursor` with `route(spots, visits)`. Arrive on the click frame, start moving 20–30 frames earlier. Measure targets with `useSpots`, not by eye. |
| Typing | `typed(text, frame, start, perSecond)`: 12–20 chars/sec when the viewer should read it; 30+ for long strings. |
| Scrolling | Measure section positions once with `useOffsets`, then scroll with `track`. |
| Colour | Black background, product lime (`accent`) reserved for the single focal point in a shot. Paper and archival photos stay off-white and black. |

### Text and callouts

- **Captions:** Use `Captions` from `src/kit` (bottom centre, white on black with lime bar) when burning captions in, or omit `<Captions>` if shipping `.srt` subtitles only. Fit `stops` either way because both subtitles and picture cues rely on them.
- **Headlines:** Use `Chip`, `Headline`, and `Mark` (lime mono chip, League Gothic headline with one highlighted word) for title cards, key questions, and closing takeaways. Keep it sparse — 3 to 5 times per video.
- **Annotations on product UI:** Use lime mono-caps tags and black panels with thin white borders so annotations never look like fake product UI.
- **Check tag widths:** Mono capitals are wide (~`0.8 × fontSize` per character), and stamps scale up before settling. Check margins so tags and stamps do not clip off-screen or cover app toolbars.

### Explaining concepts off-screen (the paper table)

For diagrams, architecture, SQL/policy examples, or real-world documents that are not inside the app, use `src/kit/paper` (`Desk`, `Sheet`, `Cutout`, `Print`, `Stamp`, `Tag`, `Panel`, `Marker`, `Marked`, `Thread`, `Pin`, `Stroke`, `Greeking`):

- **Sheets:** Place slightly off-straight (1–2°) with `put()` and put drop shadows on a wrapper (`clip-path` clips its own shadow).
- **Multi-part explainers:** Add a small compact corner map (names only, current part in lime) so viewers always know where they are.
- **Project logos:** Use `simple-icons` (already installed in `apps/studio`) or official logos rendered in grayscale ink on paper.
- **Avoid empty-table stalls:** Place the scene's base sheets down at frame 0 and reveal highlights/labels on cue, or start the first group centred and `glide` it up when the second group arrives.
- **Cut-out photos:** Generate single centred objects as black-and-white press photos on pure white (`#FFFFFF`, no grey gradient, no film edge). Crop tightly, keep the white background, and generate a scissor-cut convex-hull `clip-path` polygon in `film/photos/cuts.json`:
  ```bash
  magick in.png -colorspace Gray -level 4%,82% -blur 0x3 -threshold 58% \
    -morphology Open Disk:6 -shave 8x8 -bordercolor white -border 8 \
    -define convex-hull:background-color=white -format "%[convex-hull]" info:
  ```
  Place cut-outs at corners clear of sheet titles. Keep photos of places (offices, server rooms, tables) as rectangular `Print` cards with a white border and caption strip.
- **Stamp contrast:** Use lime or paper ink on the dark table; use dark ink on paper or white cut-outs (lime on white is unreadable).
- **Official-looking forms:** Mark any simulated official document or form with `"Illustration"`.

### Mr. Fyre (2D Procreate mascot)

Mr. Fyre is the presenter across Classifyre videos and editorial visuals. All 26 hand-drawn ink poses live in `mascot/poses/*.png` as `1200×1200` transparent RGBA PNGs (opaque white fill, transparent exterior, subtle 4 px white paper edge so they read cleanly on dark video stages, light blog pages, and colored cards alike).

Use **`MascotNarrator`** (or `Fyre2D` / `Fyre2DActor`) from `src/kit` — no Blender required. *(The older 3D Blender `Narrator` / `MrFyreActor` stays in `src/kit` only for legacy videos.)*

#### When to use which pose (Remotion videos & blog)

All directional poses face **screen right** by default. Pass `flip` to mirror him when he stands on the right side of the frame.

| Category | Pose ID | What it shows | Best use in Remotion videos | Best use in Blog / Thumbnails |
| :--- | :--- | :--- | :--- | :--- |
| **Core explaining** | `pockets` | Standing relaxed, hands in coat pockets, calm wry brows | Default idle, listening, scene openings/closings | Neutral inline spot art, About/Docs headers |
| | `explain` | One open hand gesturing forward calmly | Primary talking pose over UI or paper diagrams | Section dividers explaining how a rule works |
| | `explain-2` | Slightly higher open gesture, engaged brows | Pair with `explain` (or use `pose: "talk"`) so he moves naturally while talking | — |
| | `point` | Right arm straight out pointing right | Highlighting a specific table column, mask, button, or SQL clause | Annotated diagram callouts, YouTube thumbnails pointing at the topic |
| | `present` | Open hand held low to the right ("here it is") | Introducing a dashboard, shared dataset, or final result | Feature announcement banners, blog cover art |
| | `think` | Hand up touching hat, curious brows + `?` ticks | Asking the opening question ("who can see this column?") | Problem-statement intro sections, FAQ headers |
| **Reactions & stance** | `aha` | Index finger raised up beside hat | Key takeaway, "one rule to remember", turning point | Callout boxes (`[!TIP]` / key lesson blocks) |
| | `wave` | Friendly high wave with motion ticks | Cold open hello, title card greeting, closing goodbye | Welcome / getting-started guides, onboarding posts |
| | `spread` | Both palms open low to sides | Big picture, 4-pillar overview, "all of it together" | Architecture overview articles, platform summary |
| | `crossed` | Arms folded firmly, stern brows | Hard governance boundary ("admins don't get clear data by default") | Security / non-bypass architecture sections |
| | `stop` | Open palm held forward, stern brows | Access denied, blocked write query, masking floor enforced | "What is blocked" diagrams, WHERE-clause leak warnings |
| | `check` | Clear thumbs-up, happy brows | Certified asset (`active`), quality check passed, test green | Success/checklist summaries, certification guides |
| | `shrug` | Both palms up, tilted head, skeptical brows | Describing the messy status quo ("nobody knows who has that CSV") | "Before Classifyre" / status-quo pain-point sections |
| **Dynamic explainer** | `point-up` | Leaning back slightly, arm pointing high up-right | Pointing up to a headline, browser URL, SQL bar, or top metric | Blog covers or hero graphics pointing toward a title |
| | `lean-in` | Leaning eagerly forward-right, knees bent | Zooming into a specific row, mask value, or audit log entry | Close-up walkthrough callouts ("notice this line") |
| | `compare` | Left palm high, right palm low like scales | Comparing two options ("masked vs clear", "before vs after", "A vs B") | Comparison posts (e.g., status quo vs governed access) |
| | `peek` | Leaning sideways from an edge | Popping in playfully from the left/right edge of a browser window or card | Sidebar tips, subtle edge-peeking blog illustrations |
| | `guard` | Holding a hand-drawn padlock shield | Data protection, column masking, row filters, sovereign security | Security/compliance guides (GDPR, NIS2, EU AI Act) |
| **Motion & surprise** | `walk-1`, `walk-2`, `walk-3` | 3-frame stride facing right (use `pose: "walk"` in `Fyre2DActor`) | Walking into a scene or crossing between diagram stages | Rarely static — use `tirol-hike` if you want a static walking visual |
| | `run` | Fast lean-forward dash right, flying tie + speed lines | Skipping manual ticket queues, fast setup, snappy scene exits | "Fast setup / skip the queue" visuals, energetic thumbnails |
| | `surprised` | Single hat popped cleanly off head, neat swept hair, middle brows | Unexpected leak, export spike, or surprising `WHERE`-clause reveal *(use once per video max)* | High-contrast YouTube thumbnails for surprising technical findings |
| **Austrian / Tyrolean** | `tirol-tip` | Tipping his hat revealing a twisted Tyrolean cord & alpine feather | "Made in Austria / sovereign EU" beat, DACH intros, closing wink | Austrian/DACH posts, sovereignty & public-sector landing pages |
| | `tirol-coffee` | Holding a steaming Vienna Melange coffee cup + feather in hat | Relaxed outro, "while scheduled quality checks run", casual explainers | Long-form guide intros/outros, calm editorial headers |
| | `tirol-hike` | Walking right with alpine hiking stick + feather in hat | Step-by-step journeys, roadmaps, "from paper rules to live governance" | Roadmap posts, step-by-step tutorial series |

#### Best practices for Remotion videos

- **Entry and placement:** Enter from below the frame (`y` from ~1900 to ~1090) or walk in from off-screen with `pose: "walk"`, or lean in from a window edge with `pose: "peek"`. Stand in empty areas (sidebar `x ≈ 150`, or bottom right `x ≈ 1750` with `flip`). Size: `430–540` px tall over product UI, `660–740` px on title cards. Never cover the UI element being discussed.
- **Screen time:** Keep him on screen for roughly half the video — introducing, explaining, highlighting, and wrapping up. Drop him out during dense tables or clean full-screen UI demos.
- **Natural 2D motion without Blender:**
  - Use `pose: "talk"` on longer spoken explanations so he automatically alternates `explain` ↔ `explain-2`.
  - Use `pose: "walk"` whenever his `x` changes across a scene so he runs the 3-frame stride with a subtle step bounce.
  - Keep `bounce={true}` (default) on `MascotNarrator` / `Fyre2DActor` for a subtle 2D `spring` squash-and-stretch pop on pose switches — avoid switching poses faster than once every 1–2 seconds.
  - Set `flip` on entry cues rather than flipping him mid-shot.
- **Keep special poses special:** Use `surprised` at most once per video for a genuinely unexpected moment. Use the `tirol-*` poses tastefully (once per video or specifically on Austrian/DACH/sovereignty moments) so the secret Tyrolean hat stays a charming brand wink rather than a gimmick.
- **Layering over dark cards:** Wrap `MascotNarrator` in an `AbsoluteFill` with a higher `zIndex` than dark title or end cards so cards do not cover him.

#### Best practices for blog posts & thumbnails

- **Clean UI screenshots stay mascot-free:** Always pass `--props='{"captions":false,"fyre":false}'` when taking product screenshots for blog articles so the UI reads cleanly on its own.
- **Where the mascot shines in blog posts:**
  - **YouTube thumbnails & blog covers:** Pair 1 bold pose (`point`, `point-up`, `present`, `guard`, `surprised`, `tirol-tip`) with a clean dark background and short 3–5 word headline. Keep him on the right side of blog covers (`1952×1098`) so the left third stays dark for the overlaid article title.
  - **Section spot art / callouts:** Drop `think`, `aha`, `compare`, `stop`, `check`, or `tirol-coffee` directly onto light or dark blog blocks — the transparent PNGs already have opaque white fill and a crisp 4 px paper edge, so no extra background work or CSS inversion is needed.
- **Don't clutter an article:** 1 cover + 1–2 well-placed spot poses per post is plenty. Let real product screenshots, SQL snippets, and diagrams carry the technical body.

---

## 7. Audio and voice

- **TTS model and voice:** `google/gemini-3.8-flash-tts`, voice `Charon`. Keep the same voice across videos for consistency.
- **Default voice instruction:**
  > A middle-aged American man with a deep, calm voice: a clear, experienced engineer walking a colleague through how a system works. Plain, steady, and understated — warm, practical, and easy to follow. Keep a steady conversational pace with only brief breaths between sentences and no long pauses. Clear pronunciation. Never theatrical, never salesy, never an announcer.

  Add only script-specific pronunciation notes (for example, `"German company and city names are pronounced the German way"`).
- **Loudness:** Individual clips are normalized to `-18 LUFS`; final video export to `-14 LUFS`.
- **Pacing:** Set `VOICE.maxPause` to `0.34` so `tools/voice.ts` trims long pauses while saving raw takes in `audio/takes/`. Use `--recut` to adjust pause length without paying for new TTS calls. Keep scene `lead` and `tail` around `12–14` frames.
- **Sentence stops:** After voicing, run `bun apps/studio/tools/stops.ts <name> --write` and verify lines with commas or short openings. If a line reports `TOO FEW PAUSES`, use `at(id, n)` or `within(id, share)` instead of `sentence()` (which throws on unstopped lines). Whenever you trim or rewrite a line, re-check every `sentence(id, n)` call referencing it.
- **Pronunciation tips for `say`:**
  - Spell unfamiliar names phonetically (`"Mister Fire"` for `"Mr. Fyre"`).
  - Write numbers and acronyms out in `say` (`"I B A N"`, `"S Q L"`, `"two hundred rows"`); keep normal formatting in `text`.
  - Break short clauses after a colon into separate sentences in `say`.
  - Give unfamiliar non-English names a plain lead-in word so the model does not swallow the first syllable.
  - Check OpenRouter credits (`/api/v1/credits`) before long runs — a `402 weight_exceeds_budget` error means the account balance is lower than the max estimated request cost.
- **Automated word check:** Run `bun apps/studio/tools/hear.ts <name>` (`google/gemini-3.8-flash`). It catches dropped, added, or changed words. It often mishears brand names and homophones, so when a word looks suspicious, ask the audio model directly (for example via a quick two-line `ask.ts` prompt) before re-generating the line. Re-run if any parallel calls return `402` in-flight budget errors.
- **Subtle sound effects:** Optional lightweight ffmpeg SFX (soft key press or stamp click at volume `0.2`–`0.4`), toggleable via `--props='{"sfx":false}'`.
- **Background music:** Keep it subtle and non-distracting — a calm, minimal instrumental bed (no lead melody, no vocals, no dramatic build-up, no big ending). `tools/bed.sh` generates a simple stand-in; `tools/loop.sh <name> <piece> <seconds>` crossfades a music track to exact video length, dips 2 kHz by 4 dB for voice clarity, and levels to `-30 LUFS` (played at `0.55`). Re-run `loop.sh` whenever the total duration changes.

---

## 8. Getting product UI into the video

Choose the simplest accurate method in this order:

1. **Direct import:** Import components from `@workspace/ui` (and `@workspace/case-board` when showing a case board).
2. **Borrow from `apps/web` or `apps/blog`:** If a component takes all its data as props, expose it in `src/borrow/web.ts` or `src/borrow/blog.ts` (see `src/borrow/README.md`).
3. **Playwright screenshots of the running app (recommended for workflow demos):** Drive the real app with `film/shots/capture.mjs` (for example: create a grant, set a column mask, run a SQL query in the workbench, view a quality rule, check the read log), capture at `1483×707` (`deviceScaleFactor: 3`, dev overlay hidden), and save element positions to `marks.json`. Place the image inside `Browser` and draw lime boxes/tags inside the same `Camera` using pixel coordinates. This gives 100% real UI with zero drift in minutes instead of hours. Note in the hand-over and blog post that screens are captured from the live app.
4. **Rebuilt page from `@workspace/ui` + `T()`:** Only when you need animated typing or interactive state inside a page that cannot be borrowed. Use `AppShell` and `T("key")` from `src/kit/app-shell`, match exact columns and classes against a real screenshot, and note rebuilt screens in the hand-over.

For interactive components with local state, drive them with `fill()` and locate buttons with `useSpots`. Remember that `useSpots` measures screen coordinates including `Camera` transforms, so draw spot-based overlays outside `<Camera>`.

---

## 9. Accuracy, demo data, and honesty

- **Verify every claim against docs AND code.** Read every narration line as a factual claim before voicing it (for example: does a column trace across 2 systems or 3? Does a closed laptop pause local scans?).
- **Test the feature first.** Run the exact steps on a working instance before filming. Fix real product bugs first (raw i18n keys, broken links, wrong counts) rather than hiding them.
- **Use clearly labeled demo data.** Never expose real personal data or flag real companies on screen. Use invented companies and realistic sample tables (with consistent arithmetic), and check invented company names against public registers if they look like real businesses. State clearly once near the start (and in the description/post) that the company and sample records are demo data while the software and rules are real.
- **Freeze live workspace counts to one date.** If showing `showcase.classifyre.com` or another live workspace, recount with read-only queries on the filming day, record the queries and counts in `research.md`, show the date on screen, say "on the day we filmed", and open every shown page on the live production instance (not just local dev) to verify derived indexes match.
- **Check exact counts and legal citations.** Verify qualifiers like "most" against actual counts. Look up specific law articles (GDPR, NIS2/NISG, EU AI Act, UGB) in the official text, and always write "supports" rather than claiming legal compliance.

---

## 10. Common technical gotchas

- **Wall-clock CSS animations break renders.** Disable CSS transitions, `animate-*`, and `setInterval` in filmed pages (`src/kit/desktop.css` shows how) and drive motion from the frame.
- **Measuring under a moving `Camera` causes React error 185.** `useOffsets` and `useSpots` read transformed screen positions. If a zooming `Camera` shifts a measured scroll target, React can loop (`Maximum update depth exceeded`) on full export even when a 15th-frame check reel passes. Measure once with the camera flat (`zoom = 1`) and reuse the numbers.
- **Keyframe lists must strictly increase.** `Camera` and `track` fail if two keyframes swap order after re-voicing or trimming a line. The check reel catches this.
- **Hidden list items with `opacity: 0` still occupy space.** Mount rows when they are due instead of hiding them with opacity.
- **React Flow viewport:** `FilmBoard` never animates React Flow's internal viewport and supplies node sizes up front. Follow the same pattern for self-measuring widgets.
- **Stray headless browsers:** After aborting a render manually, run `pkill -9 -f chrome-headless-shell`.
- **Bundler cache & snapshots:** Restart `bun run studio` after editing `remotion.config.ts`. Renders snapshot code when they start; edits made mid-render are ignored.
- **Linting Node version:** `bun run lint` in `apps/studio` requires Node 22+ (`source ~/.nvm/nvm.sh && nvm use 22`).
- **Shell gotchas:** In `zsh`, unmatched globs abort the whole command line, and unquoted `$list` variables do not word-split. In background commands, use absolute paths and avoid piping through `tail` (which masks non-zero exit codes).
- **ImageMagick & OpenRouter:** Avoid `montage` (requires fonts); join grids with `magick \( a.png b.png +append \) \( c.png d.png +append \) -append`. Use `bun` (`fetch`), not system Python `urllib`, for OpenRouter requests. Showcase REST endpoints require a trailing slash (`/`).

---

## 11. Packaging: YouTube and blog posts

### YouTube

- **Upload the 4K file** (`out/<Id>-4k.mp4`) — YouTube assigns its higher-quality codec to all resolutions on 4K uploads.
- **Thumbnail:** Render the title card without captions (`bun run --cwd apps/studio still <Id> out/thumb.png --frame=<n> --props='{"captions":false}'`) scaled to `1280×720`, or create a dedicated 1-frame `videos/<name>/thumb/video.tsx`.
- **`youtube.md`:** Include:
  - 3 title options under 75 characters (clear problem or outcome first, plain wording),
  - a description whose first 2 lines work standalone (before "Show more"),
  - key links (docs, showcase, GitHub, Docker command if relevant),
  - chapters from the timeline (each chapter at least 10 seconds; merge shorter beats),
  - ~15–20 relevant tags and 3 hashtags,
  - German title and description (using DACH governance terms from Section 1),
  - a pinned comment (link to the written guide or live showcase),
  - a brief note on demo data and the date of any live workspace numbers.
- **Subtitles:** Upload English `.srt` plus every language in `SUBTITLES`. Keep translated sentence counts aligned with English (`subtitles.ts` warns on mismatches).

### Companion blog posts (EN and DE)

Every major product video gets a standalone written post in **both English and German**:

- **Where articles and guides live:**
  - EN: `apps/blog/app/(en)/blog/articles/<slug>/page.mdx`
  - DE: `apps/blog/app/(de)/de/blog/articles/<slug>/page.mdx`
  - Menu registration: add the slug to `apps/blog/app/blog/articles/_meta.js` and `apps/blog/app/de/blog/articles/_meta.js`.
- **Where scenarios and case studies live:**
  - EN: `apps/blog/app/(en)/blog/cases/<slug>/page.mdx`
  - DE: `apps/blog/app/(de)/de/blog/cases/<slug>/page.mdx`
  - Menu registration: add the slug to `apps/blog/app/blog/cases/_meta.js` and `apps/blog/app/de/blog/cases/_meta.js`.
- **How to write the post:**
  - Use the same simple, clear, practical language as the video: short paragraphs, scannable headings, concrete examples, and copy-pasteable SQL, YAML (ODCS), or CLI commands where helpful.
  - Make the post stand on its own without requiring the video. Publish the post first (or alongside the video), and add the `video` block to `<ArticleJsonLd>` once YouTube is live.
  - Copy frontmatter structure from the latest post in that section, and verify the cover image path exists.
  - Clearly note what data is demo/invented, and keep any live workspace figures frozen to the exact same date as the video in both EN and DE.
  - End with a clear summary and practical next step (try locally with Docker, walk `showcase.classifyre.com`, read the docs, or plan a pilot) — no mandatory "what the tool does not do" section.
- **Images and clips:**
  - Use Playwright captures or studio stills without captions or Mr. Fyre:
    ```bash
    bun run --cwd apps/studio still <Id> out/shot.png --frame=<n> --scale=2 --props='{"captions":false,"fyre":false}'
    ```
    Crop to the browser window (`140 100 3560 1800` at scale 2), save as WebP (2160 px wide, quality 86) under `apps/blog/public/blog/assets/images/` with descriptive filenames. If an image includes video callout annotations, mention that in the caption.
  - Cover image: `1952×1098` (`--scale=1.0167` or dedicated `cover/video.tsx`) with the left third dark so the overlaid title stays readable.
  - Use short silent looping MP4s (`--frames=a-b --muted`, cropped, 1280 px wide, CRF 25) where motion explains something a still cannot (like switching roles and watching masked values change).
- **Compile check:** Before finishing, compile both EN and DE `.mdx` files (stripped of frontmatter) with `@mdx-js/mdx` to catch stray braces or broken JSX before they break the blog build.

# PRD — Case Board (investigation canvas redesign)

| | |
|---|---|
| **Status** | In implementation: Phases 0–6 landed behind the flag; Phase 7 in progress (see §9) |
| **Date** | 2026-09-24 |
| **Owner** | Product: Andrii Fedorenko |
| **Replaces** | `apps/web/components/case-graph/*` (the custom Canvas2D + d3-force case graph) |
| **Main library** | `@xyflow/react` 12.x (React Flow) |
| **Touches** | `apps/web`, `apps/api` (Prisma, REST, WebSocket, MCP), `packages/ui` |

---

## 0. Decisions already made

These were settled while this PRD was written. Don't reopen them during implementation. Raise concerns with the owner instead.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Async collaboration now, Yjs-ready later.** State lives in Postgres and is written through one batched *ops* endpoint. Other viewers get a socket.io push. There are no live cursors in v1. | All client writes are expressed as `BoardOp`s. The same shape maps onto Y.Map mutations when we add Hocuspocus (Phase 8). |
| D2 | **User-drawn links are case-scoped** (new `case_board_links` table). A per-link **"Promote to global relationship"** writes an `edges` row (`origin = MANUAL`). | A link drawn in case A no longer leaks into case B or into lineage. |
| D3 | **Reuse `CaseThread`.** A *comment* is a `DISCUSSION` thread anchored to a board element. A *hypothesis* is a `HYPOTHESIS` thread rendered as a first-class card, and its supports/contradicts links are `CaseThreadSupport` rows drawn as edges. A *sticky note* is a lightweight board item, not a thread. | No new comment entity. Hypotheses keep their append-only evolution log. |
| D4 | **Canvas-first + a docked side panel** (revised 2026-09-25). The board fills the page. Details, Hypotheses, Add evidence, Timeline, Leads, Case file, Watches, the Evidence table and Snapshots open in **one resizable panel docked to the right** (`packages/ui` `Resizable`), toggled from an icon **rail** on the right edge. The canvas shrinks beside the panel instead of being covered by an overlay `Sheet`. There is no legend and no tab strip. | The case page's `Tabs` go away. Every current tab becomes a panel. An overlay hid the part of the board the panel was about, and its only close affordance sat under the board's header. |
| D5 | **Non-evidence neighbours appear as "suggested" ghosts.** They are faint, unpinned cards next to the evidence they connect to, and one click pins one to the board. When there are more than 30, they're hidden behind a View toggle. | Replaces today's behaviour of rendering every depth-1 neighbour as a normal node. |
| D6 | **Unattached findings go in a collapsed "+n more on this asset" row** inside the bubble. It expands in place, and each row has an **Attach** button. | Replaces the `+n` badge and the `AttachFindingsDialog`. |
| D7 | **Scale target: ≤ 300 bubbles / ~2,000 findings.** Rendering uses level of detail (LOD) plus `onlyRenderVisibleElements`. **Louvain auto-clustering is not ported.** Users group items with **Frames**. | `graph-explorer/*` stays for Discovery/Duplicates but is no longer used by cases. |
| D8 | **Relations view: assets and findings are separate nodes** (2026-09-25, after trying and dropping a polygon-per-asset design). The board speaks the old case graph's node-link language: an asset is a circle with its kind icon and name, each finding in the case is its own small circle coloured by severity, joined to its asset by a CONTAINS edge, and every edge is a straight arrow with its relation written along it. | Relations read at a glance. Findings are draggable children of their asset (their spot persists in `style.findingPositions`); links and stances end on a finding's own node. Suggested neighbours look like any asset, minus the lime "in the case" ring. |

---

## 1. Problem

A case is an investigation board: clues, evidence, links, hypotheses and a timeline on one surface. It also carries obligations: a clear mandate, **meticulous evidence preservation**, and an audit trail that can hold up in a legal or remedial process.

Today's case canvas (`apps/web/components/case-graph/case-graph-view.tsx`, 985 lines) is a **graph viewer, not a board**:

1. **The layout is not the user's.** Positions come from a force simulation (`useForceLayout`). Pins live only in memory, and every reload reshuffles the board. Nothing is saved.
2. **Linking is cumbersome.** Connecting two things means *toolbar → Connect mode → click A → click B → modal dialog → pick relation → submit*. A finding can't be linked to a finding directly unless its asset is expanded. Links go into the **global** `edges` table.
3. **It has no whiteboard primitives.** You can't add notes, frames/groups, highlights or comments.
4. **Hypotheses are second-class.** They show up as colored dots on nodes plus a legend in the sidebar. You can't see a hypothesis and its evidence as a thing on the board.
5. **The chrome is heavy and needs explaining.** There's a 300 px sidebar with a legend, stats, filters and a detail panel, plus a toolbar with modes, plus 7 tabs. The meaning of rings, dots, badges and arcs has to be learned.
6. **Evidence state is not first-class.** NEW is a badge and GONE is a dashed ring. RESOLVED/FALSE_POSITIVE are invisible. A finding whose row was deleted silently loses its `missing` flag (see §9.3).
7. **You can't collaborate.** Nobody sees what anyone else changed until they reload.

## 2. Goals & non-goals

### Goals
- G1. **The board is the case.** Opening a case lands on a full-bleed board that makes sense without a legend.
- G2. **Evidence bubbles.** Each asset renders as a card with its findings inside. Findings can't be dragged out, but each one can be linked on its own, and so can the whole bubble.
- G3. **Links are natural.** Drag from anything to anything, pick the kind of link from a small popover, and you're done. System edges (lineage, duplicates) are always shown and can't be deleted.
- G4. **Whiteboard primitives:** sticky notes, frames (named groups), highlights, comment pins (threads) and hypothesis cards.
- G5. **Everything persists in Postgres**, including every position, size, color and collapse state.
- G6. **Everything is on the timeline.** Every semantic change writes a `CaseActivity` row.
- G7. **Evidence preservation.** Findings are never removed from view by the system. They turn into ghosts. Closing a case freezes a board snapshot.
- G8. **Reuse:** `packages/ui`, the icon maps, the thread/timeline/leads components, and the graph APIs.

### Non-goals (v1)
- Real-time cursors or co-editing of the same note (Phase 8 / Yjs).
- More than one board per case.
- Freehand drawing, shapes and arrows that aren't links.
- Entity extraction (people, organisations as nodes). The domain stays *asset / finding / hypothesis*.
- Editing on mobile. Viewing on touch devices must work.
- Automatic Louvain clusters (D7).

## 3. Glossary

| Term | Meaning | Backed by |
|---|---|---|
| **Board** | The canvas of one case (1:1). | `case_boards` (new) |
| **Board item** | Anything placed on the board that has a position. | `case_board_items` (new) |
| **Evidence bubble** | Card for one piece of case evidence (usually an asset) with its attached findings inside. | item `kind=EVIDENCE` → `case_evidence` |
| **Finding row** | One finding inside a bubble. It can't be moved on its own but can be linked. | `case_findings` (snapshot) + live `findings` |
| **Suggested ghost** | A depth-1 neighbour of the evidence that isn't on the board. It isn't persisted until pinned. | `GraphService.caseGraph` traversal |
| **System edge** | Lineage, duplicate/identity, reference or containment edge produced by the platform. Locked. | `edges` (`origin ∈ SOURCE_DERIVED, INFERRED`) |
| **Global relationship** | A manual edge in the global graph, drawn before D2 or promoted from a board link. | `edges` (`origin = MANUAL`) |
| **Board link** | A link the user draws on this board. | `case_board_links` (new) |
| **Hypothesis card** | A `HYPOTHESIS` thread on the board. | item `kind=HYPOTHESIS` → `case_threads` |
| **Stance edge** | Hypothesis ⇄ evidence/finding: supports, contradicts or neutral. | `case_thread_support` |
| **Note** | Sticky note with markdown text and a color. | item `kind=NOTE` |
| **Frame** | Named, colored, resizable group. Items inside move with it. | item `kind=FRAME` (+ `parentId` on members) |
| **Comment pin** | A `DISCUSSION` thread anchored to an item, a finding row or a point. | item `kind=COMMENT` → `case_threads` |

---

## 4. Current state → new home (reuse map)

Nothing that works today may be lost. Every feature is mapped here.

| Today (file) | What it does | New home in the Case Board |
|---|---|---|
| `case-graph/graph-toolbar.tsx`: modes `select / connect / path` | Interaction modes | **Tool dock** (bottom centre): Select, Hand, Note, Frame, Hypothesis, Comment, Link. *Connect* becomes drag-to-connect. *Path* becomes **Shift+click** a second item. |
| Toolbar search | Dims non-matches | **⌘K palette** ("On this board" group, with fly-to) plus a find-as-you-type highlight |
| Toolbar "Findings visible" toggle | Expand/collapse all assets | View popover → *Expand all / Collapse all*. Per bubble: chevron or `E` |
| Toolbar "Add evidence" → `/investigations/[id]/evidence/add` | Separate page | ⌘K → *Add to board*, drag from the Leads drawer, paste a finding/asset URL onto the canvas. The old route stays as a fallback. |
| `ClusterControls`, `ClusterDetailPanel`, `ClusterOverviewPanel` | Louvain clusters | **Removed from cases** (D7). Frames replace them. |
| `graph-sidebar.tsx` → `HypothesisLegend` | Colors + focus per hypothesis | Hypothesis **cards** on the board. Clicking a card focuses its stance edges. |
| `graph-sidebar.tsx` → `HighlightFilters` (source, detector) | Dim by source/detector | View popover → *Highlight by source / detector* |
| `graph-sidebar.tsx` → `EdgeTypeFilters` | Filter edge types | View popover → *Show system links*: Lineage, Duplicates, References |
| `graph-sidebar.tsx` → `GraphLegendAndStats` | Legend and counts | **Removed.** The visuals label themselves (§5.9). Counts move to the top bar summary. |
| `node-detail-panel.tsx` | Actions and details for the selection | `NodeToolbar` above the selection, plus the context menu, plus a **details drawer** (`Sheet`) on *Open details* |
| `edge-detail-panel.tsx` | Edge origin/method/confidence | Edge **hover card** (`EdgeLabelRenderer`) plus an edge context menu |
| `graph-context-menu.tsx` (custom div) | Right-click actions | `packages/ui` **`ContextMenu`** (Radix). Same actions, grouped (§5.8) |
| `attach-findings-dialog.tsx` | Attach unattached findings | Inline "+n more on this asset" row in the bubble (D6). The dialog is deleted. |
| `new-hypothesis-dialog.tsx` | Create a hypothesis | Hypothesis tool (`T`): click to place, then inline title editing. The dialog is kept for the ⌘K flow. |
| `link-hypothesis-dialog.tsx` + `resolveTarget()` (client-side attach-then-refetch) | Link a node to a hypothesis | Drag an edge between the hypothesis card and the evidence, then pick a stance in the popover. **`resolveTarget` moves server-side** into the `stance.set` op. |
| `components/manual-edge-dialog.tsx` | Create a global manual edge | Link-kind popover (§5.4). Creates a **board link** (D2). |
| `components/rename-edge-dialog.tsx` | Rename a manual edge | Inline label editing on the link |
| `expandNode()` → `POST /graph/expand` | Load neighbours | Context menu → *Show neighbours*. Neighbours appear as suggested ghosts. |
| `layout.releasePin` | Release a force-layout pin | **Removed.** Positions are explicit. *Tidy up* (ELK) is used instead. |
| `shortestPath()` in `graph-explorer/graph-utils.ts` | Path finding | **Reused as is** for Shift+click path highlight |
| `edgeClassOf`, `EDGE_CLASS_STYLE` in `graph-explorer/graph-types.ts` | Edge class styles | **Reused** in the system edge component |
| `lib/asset-kind.ts` → `getAssetKindIcon` | Asset kind → lucide icon | **Reused** in the bubble header |
| `packages/ui/.../source-icon.tsx` → `SourceIcon` | Source brand icon | **Reused** in the bubble header |
| `SeverityBadge`, `ToneBadge`, `lib/status-tone.ts` (`STATUS_TONE`) | Severity/status pills | **Reused** for finding rows and hypothesis status |
| `case-threads.tsx` | Thread list and entries | **Reused** inside the hypothesis drawer and the comment popover |
| `case-timeline.tsx`, `case-chronology.tsx` | Activity and chronology | **Reused** in the Timeline drawer, extended with board activity types |
| `case-leads.tsx` | Lead triage | **Reused** in the Leads drawer. Leads can be dragged onto the canvas. |
| `case-inquiries-tab.tsx` | Driving watches | **Reused** in the Inquiries drawer. The top bar shows "Fed by N watches · k new". |
| `evidence-table.tsx` | Tabular evidence | **Reused** in the Evidence drawer. Clicking a row flies to its bubble. |
| Case page tab *Case file* (overview, conclusion, close) | Metadata | **Case file drawer** |
| `GET /cases/:id/graph` → `GraphService.caseGraph()` | Nodes, findings, system edges, `matchState`, hypothesis ids | **Reused as the "live layer"** of `GET /cases/:id/board` |

---

## 5. UX specification

### 5.1 Page layout

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Cases  │ Case title (inline edit) ▾OPEN  ●HIGH │ Fed by 2 watches · 3 new │ ⌘K │
│          │                                         │ ◷ Timeline  ◎ Leads 4  ☰ Case file │ AF MK │ ⋯ │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│        ┌─ Frame: "Payroll leak" ───────────────────────────┐                     │
│        │  ┌──────────────┐        ┌──────────────┐          │   ┌ ─ ─ ─ ─ ─ ─ ┐  │
│        │  │ bubble        │──────▶│ bubble        │          │     suggested    │
│        │  └──────────────┘ lineage└──────────────┘          │   └ ─ ─ ─ ─ ─ ─ ┘  │
│        └────────────────────────────────────────────────────┘                     │
│                      ✓ supports                                                   │
│             ┌──────────────────┐        ┌─────────┐                               │
│             │ H1 hypothesis    │        │ sticky  │   (💬3)                        │
│             └──────────────────┘        └─────────┘                               │
│                                                                                  │
│ [View ▾]            [ ▢ ✋ │ ▭Note ⬚Frame ◇Hyp 💬 ↗Link │ ↶ ↷ ]         [− 82% + ⤢ ▣] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar (48 px, one line):** back; title (inline edit); status select; severity; a *driving watches* chip (clicking it opens the Watches panel, and "3 new" flies to the NEW findings); ⌘K; presence avatars (§5.12); an overflow menu with *Tidy up board*, *Export PNG*, *Close case*, *Board snapshots*.
- **Right rail (44 px):** one icon per side panel — Details, Hypotheses, Add evidence | Evidence, Leads *with pending count*, Watches *with new matches*, Timeline, Case file, Snapshots — and at the bottom a toggle that folds the panel away or brings back the last one. The open panel's icon is filled; clicking it again closes the panel.
- **Side panel:** docked between the canvas and the rail, resizable by its edge (min 300 px, max 70 %), width remembered per viewer. Its header has the title, a back arrow in a single hypothesis (to the list), and a close button. `Esc` closes it once the canvas has nothing left to clear (selection, tool, path).
- **Canvas:** full remaining height, endless, dotted `Background`.
- **Bottom-left:** `View` popover (filters and highlight, §5.10).
- **Bottom-centre:** tool dock.
- **Bottom-right:** zoom − / % / +, fit (`⇧1`), mini-map toggle (`MiniMap` hidden by default, colored by item kind).
- There is **no legend**. Clicking an asset (or a suggested neighbour) with the select tool opens its **Details** in the side panel; clicking a finding opens the finding there.

### 5.2 Evidence: assets and findings as nodes (the core objects)

The board uses the node-link language of the old case graph, because it
makes relations easy to read. (A polygon-per-asset design was tried on
2026-09-24 and dropped: it scattered the findings and hid the relations.)

```
            H1 ●  ← hypothesis dots (click = focus that hypothesis)
          ╭──────╮  [+3]  ← lime: findings of the asset not in the case
  CONTAINS│  📄  │───────────►  ● ACI   regex:AT_FIRMENBUCHNUMMER: FN 12345a
          ╰──────╯   CONTAINS    ● DK    tag:Document kind: Jahresabschluss
   lime ring = in the case  [▸7]  ← findings folded away (click shows them)
      Jahresabschluss 2024…          (findings: circle in severity colour,
            │                         the detector's initials inside)
            │ TRANSFORM ──►  ◯ Jahresabschluss 2025   ← no ring: a neighbour
                                  not in the case; hover shows "+" to add it
```

**Assets** (EVIDENCE items and suggested neighbours)
- An outlined circle with the asset-kind icon, the name under it (two lines, then an ellipsis; full name on hover).
- **Lime ring** = the asset is in the case. A suggested neighbour (D5) looks the same without the ring, and offers a lime **+** on hover to add it where it stands.
- Badges: lime **+n** = findings of the asset that are not in the case (click shows them as dashed ghost findings); **▸n** = findings folded away (collapsed, or past the first 12); **NEW** = new findings are folded inside, or the asset arrived from a watch.
- **Collapsed** (`E`) or at far zoom, an asset wears its findings' severity mix as a **donut** round the circle, and edges to its findings end on the asset.
- Missing from the source: dashed red outline, name struck through.

**Findings** (one node per attached finding, children of their asset's node)
- A small circle filled with the severity colour (the old graph's palette), the detector's initials inside (`findingCode`), and `type: value` under it at full zoom.
- Default spots: up to three fan out to the right of the asset; more sit on a ring from 12 o'clock, wide enough that labels don't collide. Drag one and it keeps its spot, relative to its asset (`item.style.findingPositions`, merged per finding like `rowHighlights`). **Tidy up** sends them all back.
- Up to 12 findings are drawn per asset; the rest wait behind **▸n**.
- Links, stances and comments attach to a finding's own node. Clicking a finding opens it in the details drawer, which also lists every finding of the asset, with **Attach** for the ones not in the case.

**Finding visual states** (top-down priority, see `findingVisualState`)

| State | Derived from | Node |
|---|---|---|
| `open` | default | filled with the severity colour |
| `new` | `matchState = NEW` | filled, with a lime `NEW` tag |
| `resolved` | `status = RESOLVED` | hollow, outlined in its severity colour, green ✓ |
| `dismissed` | `status ∈ FALSE_POSITIVE, IGNORED` | hollow, grey dashed outline, label struck through |
| `gone` | `matchState = GONE` | filled, dimmed, dashed red ring |
| `deleted` | `node.missing` | hollow, grey dotted outline, half opacity |
| not in the case | unattached ("+n") | hollow, grey dashed; its CONTAINS edge dashed too |

The View popover fades settled findings (never hides them); the hover title and the details drawer always name the state in words.

> **Evidence preservation:** the system never removes a finding from the board. Only a user can **detach** it (context menu → *Detach from case*, with confirmation), and that writes `FINDING_REMOVED` to the timeline.

**Edges** follow the old graph too: straight thin lines with an arrowhead, the relation written along the line in small capitals (CONTAINS, TRANSFORM, REFERENCES, SAME_AS…), bowing apart only when several share a pair. Links people drew are amber (dashed when suspected, red for "contradicts"); stances keep their green / red / grey; whatever is selected turns lime.

**Level of detail (LOD)**

| Zoom | Bucket | Renders |
|---|---|---|
| ≥ 0.6 | `full` | Assets, findings with labels, edge labels |
| 0.3 – 0.6 | `compact` | Assets and names; finding circles without labels |
| < 0.3 | `chip` | Assets only, with severity donuts and large names |

Notes, hypothesis cards and frames follow the same three buckets.

### 5.3 Edges: visual language (self-explaining, no legend)

| Kind | Origin | Style | Hover card says | Deletable? |
|---|---|---|---|---|
| Lineage (`FLOW`) | system | solid, neutral gray, arrow | "Lineage · data flows A → B · system" 🔒 | ❌ |
| Duplicate / identity (`IDENTITY`, `likely_duplicate`, `identical_content`) | system | double line, gray | "Duplicate · 92% similar · system" 🔒 | ❌ |
| Reference / usage (`REFERENCE`, `USAGE`) | system | thin dotted gray | "References · system" 🔒 | ❌ |
| Containment (`CONTAINS`) | system | **not drawn**: the finding is inside the bubble | — | — |
| Global relationship (`edges.origin = MANUAL`) | global manual | solid ink with a 🌐 badge | "Global relationship · visible in all cases" | ⚠️ Confirmed via "Delete everywhere" |
| Board link, confirmed | user | solid ink, label chip, stroke width by confidence | kind · label · who/when | ✅ |
| Board link, suspected | user | **dashed** ink | same + "suspected" | ✅ |
| Board link `contradicts` | user | red | | ✅ |
| Stance: supports | hypothesis | green, ✓ at the hypothesis end | "Supports H1 · weight 0.8" | ✅ (unlink) |
| Stance: contradicts | hypothesis | red dashed, ✗ | | ✅ |
| Stance: neutral | hypothesis | gray, ○ | | ✅ |
| To suggested ghost | system | faint dotted | "Neighbour · not on the board · click to pin" | ❌ |

- Labels render in `EdgeLabelRenderer`. They are visible **only when zoom ≥ 0.6, on hover, or when selected**, so the board stays clean.
- System edges are `deletable: false, reconnectable: false, focusable: false` and **also rejected server-side** (they aren't in `case_board_links`, so no op can address them).
- **Anchoring:** all edges are *anchored-floating*. An endpoint on a bubble header attaches to the nearest border point. An endpoint on a finding row attaches at that row's y on the left or right border, whichever faces the other endpoint (§8.6).

### 5.4 Connecting (the "natural and easy" requirement)

1. **Ports** (revised 2026-09-25): every linkable node — asset, finding, hypothesis, note — has four. **Left and top take links in** (hollow ○); **right and bottom send them out** (filled ●). They show on hover, on a selected node's outputs, and, while a link is being pulled, on every input it could land on (the one under the pointer lights up). Drag from an output, **or** hold `L` (Link tool) and drag from anywhere on the item (the right output grows over the node).
2. Drop on an input, or anywhere on a node's body. `ConnectionMode.Strict`: a drag starts only on an output and snaps only to an input, so a link always reads source → target the way it was pulled. Ports are only where a drag starts and lands: edges still float to the nearest side of each node (§8.6), and a link stores no port. Suggested neighbours keep their ports hidden and inert (add them first).
3. A **link popover** opens at the drop point. Its content depends on the endpoints:
   - **Either end is a hypothesis:** `✓ Supports` `✗ Contradicts` `○ Neutral` (+ optional note). One click.
   - **Otherwise:** a list of kinds (recent first): `Related to`, `Same entity`, `Communicates with`, `Derived from`, `Contradicts`, `Precedes`, `Custom…`, plus a *Confirmed / Suspected* toggle and an optional label. `Enter` accepts the top item.
4. `Esc` cancels. Nothing is persisted until a kind is picked.
5. **Invalid drops** are shown with a red connection line (via `isValidConnection`) and snap back:
   - frame ↔ anything, comment ↔ anything
   - a suggested ghost (pin it first; the popover offers *Pin & link*)
   - hypothesis ↔ hypothesis (use a note)
   - an item linked to itself

### 5.5 Hypothesis card

```
 ┌─▌ H1 ───────────────────────────── SUPPORTED ─┐   ▌ = thread color stripe
 │ Payroll data left via the shared Confluence   │   statement (inline edit)
 │ space before the Q3 export job.               │
 │ confidence ▓▓▓▓▓▓▓░░░ 0.7                      │
 │ ✓ 5   ✗ 1   ○ 0      💬 4 · last: MK 2h ago    │
 └───────────────────────────────── Open thread ▸┘
```
- Created with the Hypothesis tool (`T`): click the canvas, type a statement, `Enter`. Creating one from a selection (context menu → *New hypothesis from selection*) also creates `SUPPORTS` stance edges to every selected evidence item.
- Clicking the card enters **focus mode** for that hypothesis: everything that isn't linked to it dims.
- *Open thread* opens the **hypothesis drawer**, which reuses `CaseThreads` for entries, status changes and confidence.
- Status and confidence change **only** through thread entries, which keeps the evolution log intact.

### 5.6 Notes, comments, frames

**Sticky note** (`N`)
- Click to place. Type markdown, rendered with `react-markdown` (already a dependency). Colors: yellow / blue / green / pink / gray. Resizable (`NodeResizer`, min 160×100).
- Double-click edits; `Esc` or a click outside saves. Notes can be linked like any other item.

**Comment pin** (`C`)
- Click on an item, a finding row or empty canvas. A popover opens with a composer, and posting creates a `DISCUSSION` thread plus its first `NOTE` entry.
- The pin shows the author initials and a reply count. If it's anchored to an item, it **moves with that item** (`parentId` = the anchored item).
- The popover shows the thread (reusing the thread entry list) with a reply box and a *Resolve* action (resolved pins turn gray, and a View toggle hides them).
- Every unanchored DISCUSSION thread (created elsewhere or through MCP) is listed in the Timeline drawer → *Threads* tab, with *Place on board*.

**Frame** (`F`)
- Drag a rectangle to create one, then name it and pick a tint. Resizable.
- Dropping an item inside sets `parentId`, and the item moves with the frame. Dragging it out clears `parentId`.
- A frame can be **collapsed** to its title bar. Its members are hidden, and edges to them re-route to the frame.
- Frames render below everything else (`zIndex = -1`).

### 5.7 Highlight

- Context menu or node toolbar → *Highlight* → 5 marker colors or *None*. This applies to bubbles, **individual finding rows**, notes and hypothesis cards.
- A row highlight is stored on the bubble item (`style.rowHighlights[findingId]`), so rows stay non-entities.
- View popover → *Only highlighted* dims everything else.

### 5.8 Context menus (Radix `ContextMenu` from `packages/ui`)

| Target | Items (groups separated) |
|---|---|
| **Bubble** | Open asset ↗ · Open details · — · Link from here (`L`) · Add to hypothesis ▸ (list + stance) · New hypothesis from selection · Comment · Highlight ▸ · — · Show neighbours · Collapse/expand findings (`E`) · Find path to… · — · Move to frame ▸ · Bring to front · — · **Remove from case…** (confirm) |
| **Finding row** | Open finding ↗ · Explain finding · — · Link from this finding · Add to hypothesis ▸ · Comment · Highlight ▸ · Mark resolved / false positive (uses the existing finding update) · — · **Detach from case…** |
| **Unattached row** (in "+n more") | Attach to case · Open finding ↗ |
| **Suggested ghost** | Pin to board (becomes evidence) · Open asset ↗ · Hide this suggestion |
| **Hypothesis** | Open thread · Focus · Change color ▸ · Highlight ▸ · Comment |
| **Note / Frame** | Edit · Color ▸ · Duplicate · Bring to front / Send to back · Delete (`⌫`) |
| **Board link** | Edit kind/label · Confirmed/Suspected · Confidence ▸ · Promote to global relationship · Delete (`⌫`) |
| **System edge** | Why is this here? (method/evidence/confidence) · Open both · *(no delete; shows "🔒 System link")* |
| **Pane** | Add note here · Add hypothesis here · Add comment here · Paste · Add evidence… (⌘K) · Tidy up · Fit view |

### 5.9 "Makes sense without a legend": rules for designers

1. Every visual encoding has **text** attached: chips (`NEW`, `RESOLVED`), edge hover cards, and a tooltip on every icon.
2. No meaning is carried by color alone. Color reinforces text, line pattern or an icon.
3. The meanings of edge line patterns are fixed: solid = confirmed, dashed = suspected/contradicts, dotted = system reference or suggestion, double = duplicate.
4. A lock icon appears on hover for everything the user can't delete.
5. `?` opens a **cheat sheet** (shortcuts + visual key). It's a dialog for learning, not permanent chrome.

### 5.10 View popover (replaces the sidebar filters)

- Suggested neighbours: *Auto* (hidden when > 30) / *Show* / *Hide*
- Findings: *Show resolved*, *Show dismissed*, *Show gone/deleted* (all **on** by default to preserve evidence; turning one off dims rather than hides)
- System links: Lineage / Duplicates / References checkboxes
- Highlight by: Source ▸, Detector ▸, Hypothesis ▸, *Only highlighted*
- Comments: *Show resolved comments*
- Findings in bubbles: *Expand all / Collapse all*

State is kept per user in `localStorage` (try/catch). It is **not** persisted on the board.

### 5.11 Navigation, search, focus, path

- **⌘K palette** (`packages/ui` `Command`):
  - *On this board*: items, finding rows (label, matched content, detector), notes, hypotheses. Selecting one calls `fitView({ nodes:[{id}], duration: 400 })` and pulses it.
  - *Add to board*: live search of assets/findings through `POST /search/quick` (below). Selecting one places it in the middle of the visible canvas, clear of what is there (the `evidence.add` op), attaches a finding to its asset when that is on the board already, or flies to what is there. *Search "…" with filters…* hands the query to the Add evidence panel.
- **Add evidence panel:** the same search with the filters of the assets table — one shared `AssetFilterBar` (text, source, severity, detector type) — and an *Assets / Findings / Both* switch. Click a result to add it, or drag it onto the spot it belongs.
- **`POST /search/quick`** (search as you type, meant for reuse elsewhere): never counts; asset names and finding content match by word prefix through GIN full-text indexes (`assets_name_fts_idx`, `findings_matched_content_fts_idx`), so a query that matches nothing costs an index lookup; asset names containing the query mid-word are looked for only when the words left room, under a 1.5 s cap; each step runs in its own transaction under a statement timeout and returns what it has with `truncated` rather than holding a connection. The client debounces and aborts the previous request on every keystroke. (The general searches count every match and OR a dozen substring matches across joins; a burst of them from the palette saturated the dev database.)
  - *Actions*: New note / hypothesis / frame, Tidy up, Open timeline, Open leads, Close case…
- **Focus mode:** selecting items dims everything that isn't a direct neighbour (via any visible edge). `.` toggles focus lock.
- **Path:** select A, then Shift+click B. `shortestPath()` highlights the path and a small banner shows "3 hops · clear (Esc)".
- **Timeline ⇄ board:** every timeline entry that references an item has *Show on board*.

### 5.12 Collaboration (async, v1)

- Every write goes through `POST /cases/:id/board/ops`. The server then emits `case-board:changed` to the room `ns:<schema>:case:<caseId>`.
- Other open clients refetch the board and merge it, keeping their own unflushed local ops on top. A toast reads "MK moved 3 items · added a note" (from the op summary).
- **Presence-lite:** the gateway keeps a list of the actor names subscribed to the room, and the top bar shows their avatars ("Also here: MK").
- **Identity (interim):** the app has no user model. Until auth lands, the web asks once for a *display name* (stored in `localStorage`) and sends it as the `X-Actor-Name` header. The API reads it with an `@ActorName()` decorator into `actor` / `createdBy` / `author`. See Open question Q1.
- **Conflicts:** position/size/z use last write wins per item. Note text and link labels carry `expectedUpdatedAt`, and a stale edit is rejected per op. The client shows "Changed by MK meanwhile. Your text was copied to the clipboard" and reloads that item.

### 5.13 Undo / redo

- `⌘Z` / `⇧⌘Z`, with 100 steps per session. **Only the user's own actions** are undone; system changes and other users' changes are not.
- The undo model is **command-based** (forward ops + inverse ops), not snapshot-based. Snapshot undo (zundo) was rejected because it can't tell the server what to persist, and it can't invert domain side effects such as `evidence.add` or `stance.set`.
- Undoing *Remove from case* re-adds the evidence (the server restores the item row with its old position, which is why items are soft-deleted).

### 5.14 Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `V` | Select | `Space`+drag / `H` | Pan |
| `N` | Note | `F` | Frame |
| `T` | Hypothesis | `C` | Comment |
| `L` | Link tool | `E` | Expand/collapse the selected bubble |
| `⌘K` | Palette | `?` | Cheat sheet |
| `⌘Z` / `⇧⌘Z` | Undo / redo | `⌫` / `Del` | Delete the selection (**user items only**) |
| `⇧1` | Fit view | `⇧2` | Zoom to selection |
| `.` | Focus lock | `Esc` | Clear selection/mode/path; close popover |
| `⌘A` | Select all | `⌘D` | Duplicate note/frame |

`deleteKeyCode` is set to `null` in React Flow. Deletion is routed through our own handler, which filters out everything that isn't a user item (§8.9).

### 5.15 Empty, loading, error, closed

- **Empty board:** a centred card on the canvas reads "Nothing on this board yet", with buttons [Link a watch] [Add evidence ⌘K] [Add a note].
- **Loading:** a skeleton of 3 bubble outlines. Target p95 open time is under 1.5 s at 300 bubbles.
- **Graph truncated** (`truncated=true`): a top bar warning chip reads "Showing a partial neighbourhood".
- **Inquiry stack failure:** the board still opens without NEW/GONE (the existing `badgeInquiryStates` contract).
- **Case CLOSED/ARCHIVED:** the board is **read-only** (`nodesDraggable=false`, `nodesConnectable=false`, tools disabled) with a banner: "Closed on … · snapshot #3 · Reopen to edit".

### 5.16 New evidence arriving from a watch (auto-pull)

- A new finding on an asset that is already on the board appears **inside that bubble** as a `NEW` row. The tally shows "⟲ n new".
- A new asset is created as an unplaced item. The client **auto-places** it in an *Incoming* column to the right of the board's bounding box, with a transient "New from ⟨watch⟩" marker (not persisted), until the user moves it.

---

## 6. Data model (Postgres / Prisma)

New tables live in every tenant schema, like every other case table (schema-per-namespace).

### 6.1 Prisma

```prisma
// apps/api/prisma/schema.prisma

enum CaseBoardItemKind {
  EVIDENCE    // ref_id → case_evidence.id
  HYPOTHESIS  // ref_id → case_threads.id (kind = HYPOTHESIS)
  COMMENT     // ref_id → case_threads.id (kind = DISCUSSION)
  NOTE        // ref_id null; content.text
  FRAME       // ref_id null; content.title
}

enum BoardLinkCertainty {
  CONFIRMED
  SUSPECTED
}

// One board per case. `version` bumps once per applied ops batch, so a client
// can tell "someone else wrote since I loaded" without diffing.
model CaseBoard {
  id        String   @id @default(uuid())
  caseId    String   @unique @map("case_id")
  version   Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  investigation Case                @relation(fields: [caseId], references: [id], onDelete: Cascade)
  items         CaseBoardItem[]
  links         CaseBoardLink[]
  snapshots     CaseBoardSnapshot[]

  @@map("case_boards")
}

// Everything with a position. Evidence and hypotheses are *projections* of
// domain rows (ref_id); notes and frames are board-native. Soft-deleted so undo
// can restore position/style, and so the audit trail keeps what was there.
model CaseBoardItem {
  id        String            @id @db.Uuid // client-generated (Yjs-ready); server validates
  boardId   String            @map("board_id")
  kind      CaseBoardItemKind
  refId     String?           @map("ref_id")
  // Null until placed. The client auto-places unplaced items and writes back.
  x         Float?
  y         Float?
  width     Float?
  height    Float?
  z         Int               @default(0)
  // FRAME membership for regular items; the anchor item for COMMENT pins.
  parentId  String?           @map("parent_id") @db.Uuid
  collapsed Boolean           @default(false)
  // { color?, highlight?, rowHighlights?: { [findingId]: color }, anchorFindingId? }
  style     Json?             @db.JsonB
  // NOTE: { text }  FRAME: { title }
  content   Json?             @db.JsonB
  createdBy String?           @map("created_by")
  updatedBy String?           @map("updated_by")
  createdAt DateTime          @default(now()) @map("created_at")
  updatedAt DateTime          @updatedAt @map("updated_at")
  deletedAt DateTime?         @map("deleted_at")

  board    CaseBoard       @relation(fields: [boardId], references: [id], onDelete: Cascade)
  parent   CaseBoardItem?  @relation("BoardItemParent", fields: [parentId], references: [id], onDelete: SetNull)
  children CaseBoardItem[] @relation("BoardItemParent")

  // One board item per domain row. NULL ref_ids (notes/frames) are distinct in PG.
  @@unique([boardId, kind, refId])
  @@index([boardId, deletedAt])
  @@map("case_board_items")
}

// Links a person drew on THIS board (D2). Never read by lineage or other cases.
// Endpoints are items, optionally narrowed to one finding row inside a bubble.
model CaseBoardLink {
  id              String             @id @db.Uuid
  boardId         String             @map("board_id")
  sourceItemId    String             @map("source_item_id") @db.Uuid
  sourceFindingId String?            @map("source_finding_id")
  targetItemId    String             @map("target_item_id") @db.Uuid
  targetFindingId String?            @map("target_finding_id")
  kind            String             // free-form vocabulary, like edges.relation_type
  label           String?
  certainty       BoardLinkCertainty @default(CONFIRMED)
  confidence      Decimal?           @db.Decimal(3, 2)
  note            String?            @db.Text
  // Set by link.promote — the global MANUAL edge this link was copied to.
  promotedEdgeId  String?            @map("promoted_edge_id")
  createdBy       String?            @map("created_by")
  updatedBy       String?            @map("updated_by")
  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")
  deletedAt       DateTime?          @map("deleted_at")

  board CaseBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)

  @@index([boardId, deletedAt])
  @@index([sourceItemId])
  @@index([targetItemId])
  @@map("case_board_links")
}

// Immutable board state captured on close (and on demand) — evidence preservation.
model CaseBoardSnapshot {
  id        String   @id @default(uuid())
  boardId   String   @map("board_id")
  reason    String   // CASE_CLOSED | MANUAL
  version   Int      // board.version at capture time
  payload   Json     @db.JsonB // full CaseBoardResponseDto
  createdBy String?  @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")

  board CaseBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)

  @@index([boardId, createdAt(sort: Desc)])
  @@map("case_board_snapshots")
}
```

Add `board CaseBoard?` to `model Case`.

**Extend `CaseActivityType`** (the timeline):

```prisma
enum CaseActivityType {
  // ...existing values...
  BOARD_NOTE_ADDED
  BOARD_NOTE_UPDATED
  BOARD_NOTE_REMOVED
  BOARD_FRAME_ADDED
  BOARD_FRAME_UPDATED
  BOARD_FRAME_REMOVED
  BOARD_LINK_ADDED
  BOARD_LINK_UPDATED
  BOARD_LINK_REMOVED
  BOARD_LINK_PROMOTED
  BOARD_ITEM_HIGHLIGHTED
  BOARD_ARRANGED        // coalesced moves/resizes (see §7.4)
  BOARD_SNAPSHOT_TAKEN
  COMMENT_RESOLVED
}
```

### 6.2 Migration notes (must follow)

- Generate the migration with `bunx prisma migrate dev --name case_board` on **Node 22** (Prisma tooling breaks on the default Node 16). Commit it as `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_case_board/`.
- **Never edit a migration after it has been applied anywhere.** `migrate deploy` skips it silently and every tenant schema drifts. Fixes go in a new migration.
- Adding enum values: PG allows `ALTER TYPE … ADD VALUE` inside the migration transaction as long as the new value isn't *used* in that same transaction. Don't backfill activity rows in the same migration.
- Adding the new Prisma models crashes `bun --watch` API/worker pods in dev until a `rollout restart`. That's expected.
- **Namespace data transfer:** add `caseBoard`, `caseBoardItem`, `caseBoardLink`, `caseBoardSnapshot` to `apps/api/src/data-transfer/transfer-scopes.ts` (`scope: 'investigations'`, with `idRefs` covering `id`, `boardId`, `caseId`, `refId`, `parentId`, `sourceItemId`, `targetItemId`, `promotedEdgeId`). Order them after `caseThreadSupport` and `caseEvidence`, because import regenerates ids with `uuidv5(oldId, jobId)` and `refId` must be remapped. Add the tables to `maintenance/maintenance.datasets.ts` next to `case_threads`.
- **No data backfill.** Boards and items are created lazily (§7.2). The first open of an existing case runs an ELK layout and saves it.

### 6.3 Why this shape (domain vs view)

- **The domain stays where it is.** `case_evidence`, `case_findings`, `case_threads` and `case_thread_support` keep being the truth that MCP, autopilot, leads and inquiries use. The board stores **only view state** (position, size, color, grouping) plus **board-native objects** (notes, frames, board links).
- This follows the research guidance to *separate the domain model from the canvas*. React Flow `node.data` holds only `{ itemId }`, and components look up the domain record in the store.

---

## 7. API

### 7.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/cases/:id/board` | Full board: persisted items/links + the live graph layer + stance rows + thread summaries |
| `POST` | `/cases/:id/board/ops` | **Single write path.** Applies a batch of `BoardOp`s in one transaction |
| `GET` | `/cases/:id/board/snapshots` | List snapshots |
| `GET` | `/cases/:id/board/snapshots/:snapshotId` | Read-only snapshot payload |
| `POST` | `/cases/:id/board/snapshots` | Manual snapshot |
| `POST` | `/cases/:id/board/neighbours` | `{ itemId }` → suggested ghosts for one bubble (wraps `POST /graph/expand`) |

The existing `GET /cases/:id/graph` and `/graph/*` endpoints stay unchanged: Discovery, MCP and autopilot use them.

**Controller** (`apps/api/src/controllers/case-board.controller.ts`)

```ts
@ApiTags('case-board')
@Controller('cases/:id/board')
export class CaseBoardController {
  constructor(private readonly board: CaseBoardService) {}

  @Get()
  @ReadOnlyEndpoint() // retried by DbRetryInterceptor on transient errors
  @ApiResponse({ status: 200, type: CaseBoardResponseDto })
  get(@Param('id') id: string): Promise<CaseBoardResponseDto> {
    return this.board.getBoard(id);
  }

  @Post('ops')
  @ApiResponse({ status: 200, type: ApplyBoardOpsResponseDto })
  applyOps(
    @Param('id') id: string,
    @Body() dto: ApplyBoardOpsDto,
    @ActorName() actor: string | undefined,
  ): Promise<ApplyBoardOpsResponseDto> {
    return this.board.applyOps(id, dto, actor);
  }
}
```

### 7.2 `GET /cases/:id/board`: response shape

```ts
// apps/api/src/dto/case-board.dto.ts (Swagger classes; abbreviated)
export class CaseBoardResponseDto {
  board!: { id: string; caseId: string; version: number; readOnly: boolean };
  items!: BoardItemDto[];            // persisted, deletedAt IS NULL
  links!: BoardLinkDto[];            // persisted, deletedAt IS NULL
  graph!: GraphResponseDto;          // GraphService.caseGraph(caseId, 1) — unchanged
  supports!: BoardSupportDto[];      // { id, threadId, targetType, targetId, stance, weight, note }
  threads!: BoardThreadSummaryDto[]; // hypotheses + discussions: title, status, confidence,
                                     // color, entryCount, lastEntryAt, lastAuthor, resolved
  globalManualEdgeIds!: string[];    // graph edges with origin=MANUAL (render as 🌐)
}
```

**Lazy reconciliation** runs inside `getBoard` in one short transaction and is idempotent:

```ts
// apps/api/src/case-board.service.ts
private async reconcile(caseId: string): Promise<{ boardId: string }> {
  return this.prisma.$transaction(async (tx) => {
    const board = await tx.caseBoard.upsert({
      where: { caseId }, create: { caseId }, update: {}, select: { id: true },
    });
    // Every evidence row and every thread gets exactly one item (unplaced: x/y null).
    await tx.$executeRaw`
      INSERT INTO case_board_items (id, board_id, kind, ref_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${board.id}, 'EVIDENCE'::"CaseBoardItemKind", e.id, now(), now()
        FROM case_evidence e
       WHERE e.case_id = ${caseId}
      ON CONFLICT (board_id, kind, ref_id) DO NOTHING`;
    await tx.$executeRaw`
      INSERT INTO case_board_items (id, board_id, kind, ref_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${board.id}, 'HYPOTHESIS'::"CaseBoardItemKind", t.id, now(), now()
        FROM case_threads t
       WHERE t.case_id = ${caseId} AND t.kind = 'HYPOTHESIS'
      ON CONFLICT (board_id, kind, ref_id) DO NOTHING`;
    // Items whose domain row is gone (evidence removed via MCP/autopilot) → soft-delete.
    await tx.$executeRaw`
      UPDATE case_board_items i SET deleted_at = now()
       WHERE i.board_id = ${board.id} AND i.deleted_at IS NULL AND i.kind = 'EVIDENCE'
         AND NOT EXISTS (SELECT 1 FROM case_evidence e WHERE e.id = i.ref_id)`;
    return { boardId: board.id };
  });
}
```

> Raw SQL `VALUES`/enum literals need explicit casts. Mocked Prisma won't catch a missing one, so cover this with an integration test against a real schema.

`CasesService.addEvidence`, `CaseThreadsService.create` and the auto-pull path should also call `CaseBoardService.ensureItem()` so the item exists immediately. `reconcile` is the safety net for older rows and for MCP/autopilot writes.

### 7.3 Ops: the single write path

**Validation:** there is **no global `ValidationPipe`** in this API, so DTO decorators don't run at request time. Validate ops with **zod** in the service (zod 4 is already a dependency). The same schema feeds the MCP tool.

```ts
// apps/api/src/case-board/board-ops.schema.ts
import { z } from 'zod';

const Uuid = z.string().uuid();
const Color = z.enum(['yellow', 'blue', 'green', 'pink', 'gray', 'red', 'amber', 'violet']);
const Endpoint = z.strictObject({ itemId: Uuid, findingId: z.string().min(1).optional() });
const Geometry = {
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().positive().max(4000).optional(),
  height: z.number().positive().max(4000).optional(),
};
const Style = z.strictObject({
  color: Color.optional(),
  highlight: Color.nullable().optional(),
  rowHighlights: z.record(z.string(), Color.nullable()).optional(),
  anchorFindingId: z.string().optional(),
});

export const BoardOpSchema = z.discriminatedUnion('type', [
  // ── board-native items ──
  z.strictObject({ type: z.literal('item.create'), opId: z.string(), id: Uuid,
    kind: z.enum(['NOTE', 'FRAME']), ...Geometry, parentId: Uuid.nullish(),
    style: Style.optional(), content: z.strictObject({ text: z.string().max(20_000).optional(),
      title: z.string().max(200).optional() }).optional() }),
  z.strictObject({ type: z.literal('item.update'), opId: z.string(), id: Uuid,
    patch: z.strictObject({ x: z.number().finite().optional(), y: z.number().finite().optional(),
      width: z.number().positive().optional(), height: z.number().positive().optional(),
      z: z.number().int().optional(), parentId: Uuid.nullable().optional(),
      collapsed: z.boolean().optional(), style: Style.optional(),
      content: z.record(z.string(), z.unknown()).optional() }),
    expectedUpdatedAt: z.string().datetime().optional() }),
  z.strictObject({ type: z.literal('item.delete'), opId: z.string(), id: Uuid }),
  z.strictObject({ type: z.literal('item.restore'), opId: z.string(), id: Uuid }),
  // ── board links (D2) ──
  z.strictObject({ type: z.literal('link.create'), opId: z.string(), id: Uuid,
    source: Endpoint, target: Endpoint, kind: z.string().min(1).max(64),
    label: z.string().max(200).optional(), certainty: z.enum(['CONFIRMED', 'SUSPECTED']).optional(),
    confidence: z.number().min(0).max(1).optional() }),
  z.strictObject({ type: z.literal('link.update'), opId: z.string(), id: Uuid,
    patch: z.strictObject({ kind: z.string().min(1).max(64).optional(), label: z.string().max(200).nullable().optional(),
      certainty: z.enum(['CONFIRMED', 'SUSPECTED']).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(), note: z.string().nullable().optional() }),
    expectedUpdatedAt: z.string().datetime().optional() }),
  z.strictObject({ type: z.literal('link.delete'), opId: z.string(), id: Uuid }),
  z.strictObject({ type: z.literal('link.restore'), opId: z.string(), id: Uuid }),
  z.strictObject({ type: z.literal('link.promote'), opId: z.string(), id: Uuid }),
  // ── domain commands (delegate to existing services) ──
  z.strictObject({ type: z.literal('evidence.add'), opId: z.string(), itemId: Uuid,
    entityType: z.enum(['asset', 'finding']), entityId: z.string().min(1), x: z.number(), y: z.number() }),
  z.strictObject({ type: z.literal('evidence.remove'), opId: z.string(), itemId: Uuid }),
  z.strictObject({ type: z.literal('finding.attach'), opId: z.string(), itemId: Uuid, findingId: z.string() }),
  z.strictObject({ type: z.literal('finding.detach'), opId: z.string(), itemId: Uuid, findingId: z.string() }),
  z.strictObject({ type: z.literal('hypothesis.create'), opId: z.string(), itemId: Uuid,
    title: z.string().min(1).max(500), x: z.number(), y: z.number(),
    supports: z.array(Endpoint).max(100).optional() }),
  z.strictObject({ type: z.literal('stance.set'), opId: z.string(), hypothesisItemId: Uuid,
    target: Endpoint, stance: z.enum(['SUPPORTS', 'CONTRADICTS', 'NEUTRAL']), note: z.string().optional() }),
  z.strictObject({ type: z.literal('stance.remove'), opId: z.string(), supportId: Uuid }),
  z.strictObject({ type: z.literal('comment.create'), opId: z.string(), itemId: Uuid,
    body: z.string().min(1).max(20_000), anchor: Endpoint.nullable(), x: z.number(), y: z.number() }),
  z.strictObject({ type: z.literal('comment.resolve'), opId: z.string(), itemId: Uuid, resolved: z.boolean() }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;
export const ApplyOpsSchema = z.strictObject({
  clientId: z.string().max(64),
  baseVersion: z.number().int().nonnegative(),
  ops: z.array(BoardOpSchema).min(1).max(200),
});
```

> Use `z.strictObject` rather than `z.object`. zod strips unknown keys by default, which silently *widens* what a caller can do (the same lesson as *finding filters fail closed*).

**Service core**

```ts
// apps/api/src/case-board/case-board.service.ts (excerpt)
async applyOps(caseId: string, body: unknown, actor?: string): Promise<ApplyBoardOpsResponseDto> {
  const input = ApplyOpsSchema.parse(body);          // 400 on bad input (map ZodError → BadRequest)
  await this.assertEditable(caseId);                 // CLOSED/ARCHIVED → 409
  const { boardId } = await this.reconcile(caseId);

  const result = await this.prisma.$transaction(
    async (tx) => {
      const ctx = new OpContext({ tx, caseId, boardId, actor });
      for (const op of input.ops) {
        try {
          ctx.applied.push(await this.applyOne(ctx, op));
        } catch (err) {
          if (err instanceof BoardOpRejected) ctx.rejected.push({ opId: op.opId, reason: err.message, current: err.current });
          else throw err;                             // unknown error → whole batch rolls back
        }
      }
      const { version } = await tx.caseBoard.update({
        where: { id: boardId }, data: { version: { increment: 1 } }, select: { version: true },
      });
      await this.activity.flush(ctx);                 // semantic rows + coalesced BOARD_ARRANGED
      return { version, applied: ctx.applied, rejected: ctx.rejected, stale: version - 1 > input.baseVersion };
    },
    { timeout: 15_000 },                              // keep batches ≤ 200 ops (P2028 lessons)
  );

  this.gateway.emitChanged(caseId, {
    version: result.version, actor, clientId: input.clientId, summary: summarize(input.ops),
  });
  return result;
}

private async applyOne(ctx: OpContext, op: BoardOp): Promise<AppliedOp> {
  switch (op.type) {
    case 'item.delete': {
      const item = await ctx.item(op.id);            // throws BoardOpRejected if not on this board
      if (item.kind === 'EVIDENCE' || item.kind === 'HYPOTHESIS') {
        throw new BoardOpRejected('Use evidence.remove / close the hypothesis thread instead');
      }
      const now = new Date();
      await ctx.tx.caseBoardItem.update({ where: { id: item.id }, data: { deletedAt: now, updatedBy: ctx.actor } });
      await ctx.tx.caseBoardLink.updateMany({
        where: { boardId: ctx.boardId, deletedAt: null, OR: [{ sourceItemId: item.id }, { targetItemId: item.id }] },
        data: { deletedAt: now },
      });
      ctx.record(item.kind === 'NOTE' ? 'BOARD_NOTE_REMOVED' : 'BOARD_FRAME_REMOVED', { itemId: item.id });
      return { opId: op.opId, id: item.id };
    }
    case 'link.create': {
      await ctx.assertEndpoint(op.source);           // item on this board; finding attached to that evidence
      await ctx.assertEndpoint(op.target);
      const link = await ctx.tx.caseBoardLink.create({ data: {
        id: op.id, boardId: ctx.boardId,
        sourceItemId: op.source.itemId, sourceFindingId: op.source.findingId ?? null,
        targetItemId: op.target.itemId, targetFindingId: op.target.findingId ?? null,
        kind: op.kind, label: op.label ?? null, certainty: op.certainty ?? 'CONFIRMED',
        confidence: op.confidence ?? null, createdBy: ctx.actor ?? null,
      } });
      ctx.record('BOARD_LINK_ADDED', { linkId: link.id, kind: link.kind, source: op.source, target: op.target });
      return { opId: op.opId, id: link.id };
    }
    case 'link.promote': {
      const link = await ctx.link(op.id);
      const from = await ctx.entityOf(link.sourceItemId, link.sourceFindingId); // {type:'asset'|'finding', id}
      const to = await ctx.entityOf(link.targetItemId, link.targetFindingId);
      const edge = await this.graph.createManualEdge(
        { fromType: from.type, fromId: from.id, toType: to.type, toId: to.id,
          relationType: link.kind, confidence: Number(link.confidence ?? 1) },
        ctx.tx,                                      // GraphService.createManualEdge gains an optional tx
      );
      await ctx.tx.caseBoardLink.update({ where: { id: link.id }, data: { promotedEdgeId: edge.id } });
      ctx.record('BOARD_LINK_PROMOTED', { linkId: link.id, edgeId: edge.id });
      return { opId: op.opId, id: link.id };
    }
    case 'stance.set':
      // Replaces the client-side `resolveTarget` dance: attach-if-needed happens here, in one tx.
      return this.stances.set(ctx, op);
    // ... item.create / item.update / item.restore / link.update / link.delete / link.restore
    // ... evidence.add → CasesService.addEvidence(caseId, dto, actor, tx) + item row with x/y
    // ... evidence.remove → CasesService.removeEvidence(..., tx) + soft-delete item & links
    // ... finding.attach/detach → CasesService.attachFindings / removeFinding (tx)
    // ... hypothesis.create → CaseThreadsService.create(kind HYPOTHESIS, tx) + item + optional stances
    // ... comment.create → CaseThreadsService.create(kind DISCUSSION) + first NOTE entry + COMMENT item
  }
}
```

**Refactor this needs:** `CasesService.addEvidence / removeEvidence / attachFindings / removeFinding`, `CaseThreadsService.create / addEntry / linkSupport / unlinkSupport`, and `GraphService.createManualEdge` all need an optional `tx?: TxClient` parameter, following the same pattern as `CaseActivityService.record(…, tx)`. Their REST endpoints keep their current signatures.

**Server-side invariants** (each needs a unit test):
1. No op can address a system edge. They aren't rows in `case_board_links`.
2. `item.delete` rejects `EVIDENCE` and `HYPOTHESIS`.
3. Link endpoints must be live items on **this** board. A `findingId` must be a `case_findings` row attached to that evidence.
4. `link.promote` is idempotent (`promotedEdgeId` is set → no-op). Since `edges` has a unique key on `(from,to,relationType)`, it upserts.
5. `item.update.patch.parentId` must point at a `FRAME` (or at the anchor item for a `COMMENT`) and must not create a cycle.
6. Nothing is ever hard-deleted from the board tables by ops.

### 7.4 Activity (the timeline)

| Op | `CaseActivity` row |
|---|---|
| `item.create` NOTE/FRAME | `BOARD_NOTE_ADDED` / `BOARD_FRAME_ADDED` `{ itemId, excerpt }` |
| `item.update` with `content` | `BOARD_NOTE_UPDATED` / `BOARD_FRAME_UPDATED` `{ itemId, before, after }` (text is truncated at 500 chars) |
| `item.update` with `style.highlight` / `rowHighlights` | `BOARD_ITEM_HIGHLIGHTED` `{ itemId, findingId?, color }` |
| `item.update` with **only** x/y/w/h/z/collapsed/parentId | **coalesced** `BOARD_ARRANGED` `{ count }`, **at most one row per actor per 5 minutes** (skipped if one already exists in the window; the log stays append-only) |
| `item.delete` | `BOARD_NOTE_REMOVED` / `BOARD_FRAME_REMOVED` |
| `link.*` | `BOARD_LINK_ADDED/UPDATED/REMOVED/PROMOTED` |
| `evidence.*`, `finding.*`, `hypothesis.create`, `stance.*`, `comment.create` | The **existing** types, written by the delegated services (`EVIDENCE_ADDED`, `FINDING_ADDED`, `THREAD_CREATED`, `SUPPORT_LINKED`, …) |
| `comment.resolve` | `COMMENT_RESOLVED` |

Every board activity payload carries `itemId` (and `linkId` where relevant), so the Timeline drawer can offer *Show on board*.

### 7.5 WebSocket gateway

This follows `notification-events.gateway.ts`, including **namespace-scoped rooms** resolved through `NamespaceRegistryService` (the namespace URL contract).

```ts
// apps/api/src/websocket/case-board.gateway.ts
@WebSocketGateway({ namespace: '/case-board', cors: WS_CORS, transports: ['websocket', 'polling'] })
export class CaseBoardGateway implements OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly presence = new Map<string, Map<string, string>>(); // room → socketId → actor

  constructor(private readonly cls: ClsService, private readonly namespaces: NamespaceRegistryService) {}

  @SubscribeMessage('subscribe')
  async subscribe(client: Socket, body: { caseId: string; actor?: string }) {
    const schema = await this.resolveClientSchema(client);
    if (!schema || !isUuid(body?.caseId)) return { success: false };
    const room = this.room(schema, body.caseId);
    await client.join(room);
    this.roomPresence(room).set(client.id, (body.actor ?? 'Someone').slice(0, 64));
    this.broadcastPresence(room);
    return { success: true };
  }

  handleDisconnect(client: Socket) {
    for (const [room, members] of this.presence) {
      if (members.delete(client.id)) this.broadcastPresence(room);
    }
  }

  emitChanged(caseId: string, payload: BoardChangedEvent) {
    this.server.to(this.room(this.currentSchema(), caseId)).emit('changed', payload);
  }

  private room(schema: string, caseId: string) { return `ns:${schema}:case:${caseId}`; }
  // resolveClientSchema / currentSchema / roomPresence / broadcastPresence: same as NotificationEventsGateway
}
```

> **Multi-replica:** the API and worker pods don't share memory. Emits from a worker-side auto-pull won't reach sockets held by the API pod. v1 only emits from the request path (the API). Worker-originated changes show up on the next refetch: the client refetches on window focus and every 60 s while visible. If we go multi-API-replica, add the socket.io Postgres adapter (`@socket.io/postgres-adapter`). Tracked as a Phase 6 task.

### 7.6 MCP (the UI assistant = MCP 1:1)

Add two tools in `mcp-server.factory.ts`. The catalog picks them up automatically through `McpToolsCatalogService`.

- `get_case_board`: `{ caseId }` → a compact board: items with kind/ref/position/frame, links, stance rows, thread summaries. **No** full graph payload (point to `get_case_graph` for that).
- `apply_case_board_ops`: `{ caseId, ops: BoardOp[] }` (the same zod schema; mutating, so the UI assistant gates it behind *Confirm*). This lets agents post notes ("Autopilot: 3 new matches since Tuesday"), place hypotheses and draw suspected links. Agent-created items get `createdBy = 'ai-autopilot'` and render with the `AiActorBadge`.

Update the case section of the MCP instructions (around line 260 of `mcp-server.factory.ts`) so they describe the board.

---

## 8. Frontend architecture

### 8.1 Dependencies

```bash
cd apps/web && bun add @xyflow/react@^12.11 zustand@^5 elkjs@^0.12
```

- `@xyflow/react`: canvas. Import `@xyflow/react/dist/base.css` (**not** `style.css`) and style it with our tokens.
- `zustand`: the single board store. React Flow already depends on it internally, so this adds no second paradigm.
- `elkjs`: *Tidy up* and first-open layout, run in a Web Worker like the existing `force-worker.ts`.
- **Not added in v1:** `yjs`, `@hocuspocus/*` (Phase 8), `zundo` (rejected, see §5.13).

### 8.2 Folder layout

```
apps/web/components/case-board/
  case-board.tsx                 # <ReactFlowProvider> + shell (top bar, dock, drawers)
  board-canvas.tsx               # <ReactFlow> with handlers
  store/
    board-store.ts               # zustand store: domain maps, view state, command stack
    ops.ts                       # BoardOp type (from api-client), coalesce(), invert()
    commands.ts                  # user intents → {forward, inverse} op lists
    persistence.ts               # debounced flush queue, keepalive on pagehide
    projection.ts                # store → RF nodes/edges (pure, memoized)
    finding-state.ts             # findingVisualState()
  nodes/
    evidence-bubble.tsx  finding-row.tsx  unattached-rows.tsx
    hypothesis-card.tsx  note-node.tsx  frame-node.tsx
    comment-pin.tsx  suggested-node.tsx  bubble-chip.tsx
  edges/
    anchor.ts                    # getAnchoredParams() (floating + row-anchored)
    system-edge.tsx  link-edge.tsx  stance-edge.tsx  suggested-edge.tsx
  ui/
    top-bar.tsx  tool-dock.tsx  view-popover.tsx  zoom-controls.tsx
    link-popover.tsx  board-context-menu.tsx  command-palette.tsx
    cheat-sheet.tsx  presence.tsx  empty-board.tsx
  drawers/
    timeline-drawer.tsx  leads-drawer.tsx  case-file-drawer.tsx
    inquiries-drawer.tsx  evidence-drawer.tsx  hypothesis-drawer.tsx  details-drawer.tsx
  hooks/
    use-lod.ts  use-focus-set.ts  use-auto-place.ts  use-elk-layout.ts
    use-board-socket.ts  use-board-shortcuts.ts  use-actor-name.ts
  __tests__/                     # playwright-ct component tests
```

### 8.3 Store (single source of truth)

```ts
// apps/web/components/case-board/store/board-store.ts
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CaseBoardResponseDto } from "@workspace/api-client";
import { applyLocal, type BoardOp } from "./ops";
import type { Command } from "./commands";
import { createPersistence } from "./persistence";
import { buildDomain, type BoardDomain } from "./domain";

export interface BoardState extends BoardDomain {
  caseId: string;
  version: number;
  readOnly: boolean;
  undoStack: Command[];
  redoStack: Command[];

  hydrate(res: CaseBoardResponseDto): void;
  /** Apply a user intent: optimistic local apply → queue ops → push onto the undo stack. */
  run(cmd: Command): void;
  undo(): void;
  redo(): void;
  /** Server refused some ops: roll them back locally. */
  rollback(opIds: string[]): void;
}

export const createBoardStore = (caseId: string) =>
  create<BoardState>()(
    subscribeWithSelector((set, get) => {
      const persistence = createPersistence(caseId, {
        getVersion: () => get().version,
        onApplied: (res) => set({ version: res.version }),
        onRejected: (opIds) => get().rollback(opIds),
      });

      return {
        caseId,
        version: 0,
        readOnly: false,
        undoStack: [],
        redoStack: [],
        ...buildDomain(null),

        hydrate(res) {
          // Keep unflushed local ops on top of the fresh server state.
          const pending = persistence.pending();
          const domain = pending.reduce(applyLocal, buildDomain(res));
          set({ ...domain, version: res.board.version, readOnly: res.board.readOnly });
        },

        run(cmd) {
          if (get().readOnly) return;
          set((s) => cmd.forward.reduce(applyLocal, s as BoardDomain));
          persistence.enqueue(cmd.forward);
          set((s) => ({ undoStack: [...s.undoStack.slice(-99), cmd], redoStack: [] }));
        },

        undo() {
          const cmd = get().undoStack.at(-1);
          if (!cmd) return;
          set((s) => cmd.inverse.reduce(applyLocal, s as BoardDomain));
          persistence.enqueue(cmd.inverse);
          set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, cmd] }));
        },

        redo() {
          const cmd = get().redoStack.at(-1);
          if (!cmd) return;
          get().run(cmd); // run() clears redo; restore the remainder:
          set((s) => ({ redoStack: s.redoStack.slice(0, -1) }));
        },

        rollback(opIds) {
          /* re-hydrate from server; simplest correct behaviour for v1 */
        },
      };
    }),
  );
```

`BoardDomain` holds `Map`s keyed by item id: `items`, `links`, `bubbles` (evidence item id → `{ asset, findings[], unattached[], severityCounts, missing }` built from `graph.nodes`), `suggested`, `systemEdges`, `supports`, `threads`. It's built once per hydrate by `buildDomain()`, a pure function with unit tests.

**Commands and inverses** (client-generated UUIDs, so no temp-id remapping, which is also Yjs-ready):

```ts
// apps/web/components/case-board/store/commands.ts
export interface Command { label: string; forward: BoardOp[]; inverse: BoardOp[] }

export function addNote(at: XY, color: NoteColor = "yellow"): Command {
  const id = crypto.randomUUID();
  return {
    label: "Add note",
    forward: [{ type: "item.create", opId: opId(), id, kind: "NOTE", x: at.x, y: at.y,
                width: 220, height: 160, style: { color }, content: { text: "" } }],
    inverse: [{ type: "item.delete", opId: opId(), id }],
  };
}

export function moveItems(moves: { id: string; from: XY; to: XY }[]): Command {
  return {
    label: moves.length === 1 ? "Move item" : `Move ${moves.length} items`,
    forward: moves.map((m) => ({ type: "item.update", opId: opId(), id: m.id, patch: m.to })),
    inverse: moves.map((m) => ({ type: "item.update", opId: opId(), id: m.id, patch: m.from })),
  };
}

export function createLink(input: NewLink): Command {
  const id = crypto.randomUUID();
  return {
    label: "Link",
    forward: [{ type: "link.create", opId: opId(), id, ...input }],
    inverse: [{ type: "link.delete", opId: opId(), id }],
  };
}

export function removeEvidence(item: BoardItem): Command {
  return {
    label: "Remove from case",
    forward: [{ type: "evidence.remove", opId: opId(), itemId: item.id }],
    // Server restores the soft-deleted item (same id, old position) when evidence is re-added.
    inverse: [{ type: "evidence.add", opId: opId(), itemId: item.id,
                entityType: item.entityType, entityId: item.entityId, x: item.x!, y: item.y! }],
  };
}
```

### 8.4 Persistence (debounced, coalesced)

```ts
// apps/web/components/case-board/store/persistence.ts
const FLUSH_MS = 600;

export function createPersistence(caseId: string, hooks: PersistenceHooks) {
  let queue: BoardOp[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const clientId = crypto.randomUUID();

  const flush = async () => {
    timer = null;
    if (inFlight) await inFlight;             // strictly serial batches
    const batch = coalesce(queue.splice(0, 200));
    if (batch.length === 0) return;
    inFlight = (async () => {
      try {
        const res = await api.caseBoard.caseBoardControllerApplyOps({
          id: caseId,
          applyBoardOpsDto: { clientId, baseVersion: hooks.getVersion(), ops: batch },
        });
        hooks.onApplied(res);
        if (res.rejected.length) {
          hooks.onRejected(res.rejected.map((r) => r.opId));
          toast.warning(res.rejected[0]!.reason);
        }
        if (res.stale) hooks.onStale?.();     // someone else wrote → refetch & merge
      } catch (err) {
        queue.unshift(...batch);               // retry on next flush (resilientFetch handles transients)
        toast.error("Couldn't save board changes. Retrying…");
        schedule(3000);
      } finally {
        inFlight = null;
        if (queue.length) schedule();
      }
    })();
  };

  const schedule = (ms = FLUSH_MS) => { if (!timer) timer = setTimeout(() => void flush(), ms); };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => { if (queue.length) void flush(); /* fetch keepalive */ });
  }

  return {
    clientId,
    enqueue(ops: BoardOp[]) { queue.push(...ops); schedule(); },
    pending: () => [...queue],
  };
}

/** Merge consecutive geometry-only updates of the same item (drag storms → 1 op). */
export function coalesce(ops: BoardOp[]): BoardOp[] {
  const out: BoardOp[] = [];
  for (const op of ops) {
    const prev = out.at(-1);
    if (prev?.type === "item.update" && op.type === "item.update" && prev.id === op.id
        && !prev.expectedUpdatedAt && !op.expectedUpdatedAt) {
      prev.patch = { ...prev.patch, ...op.patch };
      continue;
    }
    out.push({ ...op });
  }
  return out;
}
```

**Persist on `onNodeDragStop`**, never on every drag frame. During a drag, React Flow's own internal state moves the node, and we commit one `moveItems` command when the drag stops.

### 8.5 Projection: store → React Flow

```ts
// apps/web/components/case-board/store/projection.ts
import type { Edge, Node } from "@xyflow/react";

export type BoardNode =
  | Node<{ itemId: string }, "evidence" | "hypothesis" | "note" | "frame" | "comment">
  | Node<{ suggestedKey: string }, "suggested">;

export function projectNodes(d: BoardDomain, view: ViewState): BoardNode[] {
  const nodes: BoardNode[] = [];
  for (const item of d.items.values()) {
    if (item.x == null || item.y == null) continue;          // unplaced → use-auto-place handles it
    nodes.push({
      id: item.id,
      type: item.kind.toLowerCase() as BoardNode["type"],
      position: { x: item.x, y: item.y },
      data: { itemId: item.id },                              // keep data tiny (research §1)
      parentId: item.parentId ?? undefined,
      zIndex: item.kind === "FRAME" ? -1 : item.z,
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      dragHandle: item.kind === "EVIDENCE" ? ".bubble-drag" : undefined,
      deletable: item.kind === "NOTE" || item.kind === "FRAME" || item.kind === "COMMENT",
      className: view.dimmed?.has(item.id) ? "is-dimmed" : undefined,
      hidden: item.parentId != null && d.items.get(item.parentId)?.collapsed === true,
    });
  }
  if (view.showSuggested) for (const s of d.suggested.values()) nodes.push(suggestedNode(s));
  // React Flow requires parents before children.
  return sortParentsFirst(nodes);
}

export function projectEdges(d: BoardDomain, view: ViewState): Edge[] {
  const edges: Edge[] = [];
  for (const e of d.systemEdges.values()) {
    if (!view.edgeClasses.has(e.cls)) continue;
    const s = d.resolveEndpoint(e.from);                      // → { nodeId, handle } or null
    const t = d.resolveEndpoint(e.to);
    if (!s || !t || s.nodeId === t.nodeId) continue;          // CONTAINS and intra-bubble edges vanish
    edges.push({
      id: `sys:${e.id}`, type: e.isGlobalManual ? "link" : "system",
      source: s.nodeId, sourceHandle: s.handle, target: t.nodeId, targetHandle: t.handle,
      deletable: false, reconnectable: false, focusable: false,
      data: { systemEdgeId: e.id },
    });
  }
  for (const l of d.links.values()) {
    edges.push({
      id: l.id, type: "link",
      source: l.sourceItemId, sourceHandle: l.sourceFindingId ? `f:${l.sourceFindingId}` : "h",
      target: l.targetItemId, targetHandle: l.targetFindingId ? `f:${l.targetFindingId}` : "h",
      data: { linkId: l.id },
    });
  }
  for (const s of d.supports.values()) edges.push(stanceEdge(d, s));
  return collapseParallel(reroutedForCollapsed(d, edges)); // collapsed bubble/frame → header; ×n badge
}
```

`resolveEndpoint` maps graph entities to board endpoints:

| Graph endpoint | Board endpoint |
|---|---|
| `asset:<id>` that is evidence | `{ nodeId: itemOf(evidence), handle: "h" }` |
| `finding:<id>` attached | `{ nodeId: itemOf(parent evidence), handle: "f:<id>" }` (or `"h"` if collapsed) |
| `finding:<id>` unattached, on an evidence asset | `{ nodeId: parent bubble, handle: "h" }` only while "+n more" is expanded; hidden otherwise |
| `asset:<id>` not evidence | `{ nodeId: "sg:<id>", handle: "h" }` if suggested ghosts are visible; otherwise the edge is dropped |

### 8.6 Anchored floating edges

```ts
// apps/web/components/case-board/edges/anchor.ts
import { Position, type InternalNode } from "@xyflow/react";

type XY = { x: number; y: number };
const rect = (n: InternalNode) => ({
  x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? 0, h: n.measured.height ?? 0,
});
const centre = (n: InternalNode): XY => { const r = rect(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

/** Row handles ("f:<id>") anchor at the row's y on whichever side faces `towards`. */
function rowAnchor(n: InternalNode, handleId: string, towards: XY) {
  const hb = [...(n.internals.handleBounds?.source ?? []), ...(n.internals.handleBounds?.target ?? [])]
    .find((h) => h.id === handleId);
  if (!hb) return null;
  const r = rect(n);
  const right = towards.x > r.x + r.w / 2;
  return { x: right ? r.x + r.w : r.x, y: r.y + hb.y + hb.height / 2, pos: right ? Position.Right : Position.Left };
}

/** Nearest border point of `n` on the line from its centre to `towards`. */
function borderAnchor(n: InternalNode, towards: XY) {
  const r = rect(n); const c = centre(n);
  const dx = towards.x - c.x, dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: c.y, pos: Position.Top };
  const sx = (r.w / 2) / Math.abs(dx || 1e-9), sy = (r.h / 2) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  const x = c.x + dx * s, y = c.y + dy * s;
  const pos = sx < sy ? (dx > 0 ? Position.Right : Position.Left) : (dy > 0 ? Position.Bottom : Position.Top);
  return { x, y, pos };
}

export function getAnchoredParams(
  s: InternalNode, t: InternalNode, sHandle?: string | null, tHandle?: string | null,
) {
  const sc = centre(s), tc = centre(t);
  const a = (sHandle?.startsWith("f:") && rowAnchor(s, sHandle, tc)) || borderAnchor(s, tc);
  const b = (tHandle?.startsWith("f:") && rowAnchor(t, tHandle, sc)) || borderAnchor(t, sc);
  return { sx: a.x, sy: a.y, sourcePos: a.pos, tx: b.x, ty: b.y, targetPos: b.pos };
}
```

```tsx
// apps/web/components/case-board/edges/link-edge.tsx
export const LinkEdge = memo(function LinkEdge({ id, source, target, sourceHandleId, targetHandleId, selected, data }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const link = useBoard((st) => (data?.linkId ? st.links.get(data.linkId) : undefined));
  const showLabel = useStore((st) => st.transform[2] >= 0.6) || selected;
  if (!s || !t || !link) return null;

  const p = getAnchoredParams(s, t, sourceHandleId, targetHandleId);
  const [path, lx, ly] = getBezierPath({ sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sourcePos,
                                         targetX: p.tx, targetY: p.ty, targetPosition: p.targetPos });
  const width = 1.5 + 2 * Number(link.confidence ?? 0.5);
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={16}
        style={{
          stroke: link.kind === "contradicts" ? "var(--destructive)" : "var(--foreground)",
          strokeWidth: width,
          strokeDasharray: link.certainty === "SUSPECTED" ? "6 4" : undefined,
        }} />
      {showLabel && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan absolute border border-border bg-card px-1.5 py-0.5 text-[11px]"
               style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, pointerEvents: "all" }}>
            {link.label ?? humanizeKind(link.kind)}
            {link.promotedEdgeId && <Globe className="ml-1 inline size-3" aria-label="Global relationship" />}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
```

### 8.7 Assets and findings (relations view)

The design is in §5.2. The code:

- `store/relations.ts`: the pure geometry. Node sizes (`ASSET_NODE`, `FINDING_NODE`), `shownFindings` (the first 12 plus ghosts on demand), `defaultFindingSpot` / `findingSpot`, `evidenceExtent` (an asset plus its findings, with the negative offsets layout needs), `circleAnchor`, `findingCode`, `severityMix` and the `fd:<itemId>:<findingId>` node ids. Unit-tested in `relations.spec.ts`.
- `store/projection.ts` emits an `evidence` node per asset and a `finding` node per shown finding, with `parentId` set to the asset so React Flow moves them together, plus a `contains` edge for each. Round nodes carry `data.round`, which the anchors read. The resolver maps `{itemId, findingId}` to the finding's node while it is shown, otherwise to the asset. `bendParallel` bows edges that share a pair.
- `edges/anchor.ts` and `use-edge-geometry.ts`: circle anchors for round nodes and border anchors for cards. Edges are straight segments, or quadratics when bent, with an upright label angle. `EdgeText` writes the relation along the edge with a background halo.
- `nodes/asset-node.tsx` is the shell shared by `evidence-bubble.tsx` and `suggested-node.tsx`. `nodes/finding-node.tsx` draws a finding. `nodes/relation-glyphs.tsx` holds the circle drawings, which the cheat sheet reuses.
- Dragging a finding runs `moveFindings`, a `style.findingPositions` patch whose inverse restores the previous spot or the default one. Tidy-up lays out each asset with its findings as one box, maps finding-to-finding edges onto their assets, and runs `resetFindingPositions`.

### 8.8 Canvas wiring

```tsx
// apps/web/components/case-board/board-canvas.tsx (excerpt)
const nodeTypes = {                     // module scope — never recreated
  evidence: EvidenceBubble, hypothesis: HypothesisCard, note: NoteNode,
  frame: FrameNode, comment: CommentPin, suggested: SuggestedNode,
} satisfies NodeTypes;
const edgeTypes = {
  system: SystemEdge, link: LinkEdge, stance: StanceEdge, suggested: SuggestedEdge,
} satisfies EdgeTypes;

export function BoardCanvas() {
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow();
  const nodes = useProjectedNodes();       // memoized projectNodes(domain, view)
  const edges = useProjectedEdges();
  const readOnly = useBoard((s) => s.readOnly);
  const run = useBoard((s) => s.run);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const dragStart = useRef(new Map<string, XY>());

  // React Flow owns transient drag state; we commit once on drag stop.
  const [rfNodes, setRfNodes] = useState(nodes);
  useEffect(() => setRfNodes(nodes), [nodes]);
  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    setRfNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== "remove"), ns));
  }, []);

  const onNodeDragStart: OnNodeDrag<BoardNode> = (_, __, dragged) => {
    dragStart.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  };
  const onNodeDragStop: OnNodeDrag<BoardNode> = (_, __, dragged) => {
    const moves = dragged
      .filter((n) => n.type !== "suggested")
      .map((n) => ({ id: n.id, from: dragStart.current.get(n.id)!, to: n.position }))
      .filter((m) => m.from && (m.from.x !== m.to.x || m.from.y !== m.to.y));
    const reparent = frameMembershipChanges(rf, dragged);   // getIntersectingNodes → FRAME parentId
    if (moves.length || reparent.length) run(combine(moveItems(moves), reparent));
  };

  const isValidConnection = useCallback((c: Connection | Edge) => validConnection(c, getKind), []);
  const onConnectEnd: OnConnectEnd = (event, state) => {
    if (!state.isValid || !state.toNode) return;
    const { clientX, clientY } = "changedTouches" in event ? event.changedTouches[0]! : event;
    setPendingLink({
      source: { itemId: state.fromNode!.id, findingId: findingOf(state.fromHandle?.id) },
      target: { itemId: state.toNode.id, findingId: findingOf(state.toHandle?.id) },
      screen: { x: clientX, y: clientY },
    });
  };

  const onBeforeDelete: OnBeforeDelete<BoardNode, Edge> = async ({ nodes, edges }) => ({
    nodes: nodes.filter((n) => n.deletable),                 // never evidence/hypothesis/suggested
    edges: edges.filter((e) => !e.id.startsWith("sys:")),    // never system edges
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full w-full">
          <ReactFlow
            nodes={rfNodes} edges={edges}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
            onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={null}                      /* our shortcut handler deletes via commands */
            onNodeContextMenu={(_, n) => setMenuTarget(targetOfNode(n))}
            onEdgeContextMenu={(_, e) => setMenuTarget(targetOfEdge(e))}
            onPaneContextMenu={(e) => setMenuTarget({ kind: "pane", at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })}
            onDrop={onDropFromDrawer} onDragOver={allowDrop}          /* drag leads/search results in */
            nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
            selectionOnDrag panOnDrag={[1, 2]} panOnScroll zoomOnPinch
            selectionMode={SelectionMode.Partial}
            onlyRenderVisibleElements
            minZoom={0.05} maxZoom={2}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            proOptions={{ hideAttribution: true }}   /* requires React Flow Pro subscription — see Q6 */
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <BoardShortcuts />
            <Panel position="bottom-left"><ViewPopover /></Panel>
            <Panel position="bottom-center"><ToolDock /></Panel>
            <Panel position="bottom-right"><ZoomControls /></Panel>
            <OptionalMiniMap />
          </ReactFlow>
        </div>
      </ContextMenuTrigger>
      <BoardContextMenuContent target={menuTarget} />
      {pendingLink && <LinkPopover pending={pendingLink} onClose={() => setPendingLink(null)} />}
    </ContextMenu>
  );
}
```

> **Context menu mechanics:** React Flow's `on*ContextMenu` handlers fire on the inner element first and set `menuTarget` synchronously. The same native `contextmenu` event then bubbles to the Radix `ContextMenuTrigger`, which opens the menu. Don't call `preventDefault()` in the React Flow handlers.

```ts
// Valid connections (also enforced server-side where it matters)
export function validConnection(c: Connection | Edge, kindOf: (id: string) => NodeKind | undefined) {
  const a = kindOf(c.source), b = kindOf(c.target);
  if (!a || !b) return false;
  if (c.source === c.target && c.sourceHandle === c.targetHandle) return false;
  if (a === "frame" || b === "frame" || a === "comment" || b === "comment") return false;
  if (a === "suggested" || b === "suggested") return false;       // pin first
  if (a === "hypothesis" && b === "hypothesis") return false;
  return true;
}
```

### 8.9 Level of detail, focus, auto-placement

```ts
// hooks/use-lod.ts — one narrow subscription per node; re-renders only when the bucket flips
export type Lod = "full" | "compact" | "chip";
export const useLod = (): Lod =>
  useStore((s) => (s.transform[2] >= 0.6 ? "full" : s.transform[2] >= 0.3 ? "compact" : "chip"));
```

```ts
// hooks/use-focus-set.ts — dim everything but the selection's direct neighbours
export function useFocusSet(edges: Edge[]): Set<string> | null {
  const selected = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id).join(","));
  return useMemo(() => {
    if (!selected) return null;
    const keep = new Set(selected.split(","));
    for (const e of edges) {
      if (keep.has(e.source)) keep.add(e.target);
      if (keep.has(e.target)) keep.add(e.source);
    }
    return keep;
  }, [selected, edges]);
}
// projection sets className "is-dimmed" (opacity .2, pointer-events auto) — no per-node store reads
```

```ts
// hooks/use-auto-place.ts — place unplaced items near what they connect to, then persist
export function useAutoPlace() {
  const run = useBoard((s) => s.run);
  const unplaced = useBoard(selectUnplaced);         // items with x == null
  const rf = useReactFlow();
  useEffect(() => {
    if (unplaced.length === 0) return;
    const placedRects = rf.getNodes().map(rectOf);
    // First open of a legacy case: nothing is placed → full ELK layout.
    if (placedRects.length === 0) { void elkLayoutAll().then((pos) => run(placeItems(pos, "Initial layout"))); return; }
    const incomingX = Math.max(...placedRects.map((r) => r.x + r.w)) + 240;
    const positions = new Map<string, XY>();
    let incomingY = Math.min(...placedRects.map((r) => r.y));
    for (const item of unplaced) {
      const anchor = centroidOfPlacedNeighbours(item);          // via system edges / supports
      const pos = anchor
        ? spiralFreeSpot(anchor, sizeOf(item), [...placedRects, ...rects(positions)])
        : { x: incomingX, y: (incomingY += sizeOf(item).h + 32) };   // "Incoming" column (§5.16)
      positions.set(item.id, pos);
    }
    run(placeItems(positions, "Auto-place"));
  }, [unplaced, rf, run]);
}
```

```ts
// hooks/use-elk-layout.ts — "Tidy up" (selection or whole board), in a worker
import ELK from "elkjs/lib/elk-api";
const elk = new ELK({ workerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)) });

export async function elkLayout(nodes: BoardNode[], edges: Edge[]): Promise<Map<string, XY>> {
  const res = await elk.layout({
    id: "root",
    layoutOptions: { "elk.algorithm": "stress", "elk.stress.desiredEdgeLength": "360", "elk.spacing.nodeNode": "80" },
    children: nodes.filter((n) => !n.parentId).map((n) => ({
      id: n.id, width: n.measured?.width ?? 320, height: n.measured?.height ?? 180,
    })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  return new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}
```

*Tidy up* is **one undoable command**. It only runs on explicit request, never continuously.

### 8.10 Socket hook

```ts
// hooks/use-board-socket.ts — mirrors use-notifications-websocket.ts
export function useBoardSocket(caseId: string, clientId: string, refetch: () => void) {
  const actor = useActorName();
  const setPresence = useBoard((s) => s.setPresence);
  useEffect(() => {
    const socket = io(`${wsBase()}/case-board`, { path: nsSocketPath(), transports: ["websocket", "polling"] });
    socket.on("connect", () => socket.emit("subscribe", { caseId, actor }));
    socket.on("changed", (e: BoardChangedEvent) => {
      if (e.clientId === clientId) return;                 // our own write
      refetch();                                           // merge keeps our pending ops
      toast(`${e.actor ?? "Someone"} ${e.summary}`, { id: `board-${caseId}` });
    });
    socket.on("presence", (members: string[]) => setPresence(members.filter((m) => m !== actor)));
    return () => { socket.disconnect(); };
  }, [caseId, clientId, actor, refetch, setPresence]);
}
```

### 8.11 Page integration

```tsx
// apps/web/app/[locale]/[namespaceSlug]/(dashboard)/investigations/[id]/page.tsx
const CaseBoard = dynamic(() => import("@/components/case-board/case-board").then((m) => m.CaseBoard), { ssr: false });

function CaseWorkspaceInner() {
  const caseId = useRouteId();
  const { caseBoard: boardV2 } = useWorkspaceFeatures(); // new switch added in Phase 0 (hooks/use-workspace-features.ts)
  if (boardV2) return <CaseBoard caseId={caseId} />;  // full-bleed, owns top bar + drawers
  return <LegacyCaseWorkspace caseId={caseId} />;     // current file, renamed; deleted in Phase 7
}
```

The dashboard layout needs a **full-bleed variant** for this route: no page padding, and height `calc(100dvh - app header)`.

### 8.12 Styling & theming

- Import `@xyflow/react/dist/base.css` once in `case-board.tsx`, and map React Flow CSS variables to our tokens in `globals.css`:

```css
.react-flow {
  --xy-background-color: var(--background);
  --xy-node-border-radius: var(--radius);
  --xy-edge-stroke: var(--muted-foreground);
  --xy-selection-background-color: color-mix(in oklab, var(--foreground) 6%, transparent);
  --xy-minimap-background-color: var(--card);
}
.react-flow .is-dimmed { opacity: .2; transition: opacity .15s; }
.board-connector { width: 10px; height: 10px; border: 2px solid var(--foreground); background: var(--background); }
```

- Highlight colors are defined as tokens (`--highlight-yellow`, …) with dark-mode variants. Don't hand-roll tones for status pills; use `STATUS_TONE` from `lib/status-tone.ts`.
- `--accent` is a **surface**, never ink: use `bg-accent text-accent-ink` for the `NEW` chip.
- Avoid heavy shadows, blur and animation on nodes (the performance rules). Hover and selection use borders only.
- i18n: all strings go under a new `caseBoard.*` namespace in `apps/web/i18n/en.json` and `de.json`. Delete `caseGraph.*` in Phase 7.

---

## 9. Implementation phases

> **Status, 2026-09-25.** Phases 0–6 are implemented behind the flag. From
> Phase 7: the en/de i18n, the unit tests (store, commands, relations geometry), the API
> e2e suite (`test/case-board.e2e-spec.ts`) and the MCP tools are done. Still
> open: the performance pass at 300 bubbles, Playwright e2e, the flag
> default and the legacy deletions. Where the build differs from the text below:
> - **Flag:** `InstanceSettings.caseBoardEnabled` (Settings, default off) plus a `?board=1|0` URL override. It is not a workspace feature switch.
> - **Items:** the lazy reconcile on read and the ops create board items. There are no `ensureItem` hooks in the case services.
> - **Ops:** `thread.place` puts an existing thread on the board. `stance.remove` is addressed by `(hypothesisItemId, target)`, and `item.delete` on a hypothesis card only takes it off the board (the thread stays).
> - **Evidence:** assets and findings are separate nodes in the old graph's language (D8, §5.2). The full finding list lives in the details panel.
> - **Panels:** a docked, resizable side panel with a rail replaced the overlay drawers (D4 revised); a Hypotheses panel lists every hypothesis with *Place on board*, so a card taken off the board is one click from coming back.
> - **Ports and frames:** links are pulled from an output port to an input port (§5.4). *Move to frame* puts the item in a free spot inside the frame, growing the frame when it is full (it used to keep the item where it was and only re-parent it).
> - **Persistence:** the queue starts and stops with the board's mount (`connect()`), not with the store, because StrictMode and Fast Refresh remount the same store. A 4xx batch is dropped and the board refetches, rather than retrying forever.

Sizes: **S** ≤ 2 dev-days, **M** 3–5, **L** 6–10. Each phase ships behind the `caseBoard` workspace feature switch and must pass `bun lint` (API lint is a CI gate: `require-await` and similar are errors), `bun check-types`, and its own tests.

### Phase 0: Spike & foundations (M)

**Goal:** prove performance and the look before building on them.

- [ ] Add dependencies (§8.1). Add the `caseBoard` flag (Settings → Features pattern, default off).
- [ ] Throwaway spike: render `GET /cases/:id/graph` as React Flow nodes using a static bubble component and 300 synthetic bubbles with 2,000 rows. Measure pan/zoom FPS (Chrome performance panel, 4× CPU throttle) with and without `onlyRenderVisibleElements` and LOD.
- [ ] Design review of the bubble, the edge language and the dock with the owner, using Figma or the spike.
- [ ] Confirm React Flow attribution and licensing (Q6).

**Acceptance:** ≥ 50 fps pan at 300 bubbles on an M1 at 1× throttle, and ≥ 30 fps at 4×. The bubble visual is approved.

### Phase 1: Data model & Board API (L)

- [ ] Prisma models + migration (§6.1–6.2), transfer scopes, maintenance datasets.
- [ ] `CaseBoardService`: `getBoard` (reconcile + `GraphService.caseGraph` + supports + thread summaries), `applyOps` (every op in §7.3), `OpContext`, `BoardOpRejected`.
- [ ] Add an optional `tx` parameter to the delegated services (§7.3 refactor).
- [ ] `@ActorName()` param decorator (reads `X-Actor-Name`, trims to 64 chars, falls back to `undefined`). Add the header to CORS `allowedHeaders`.
- [ ] Activity recording + `BOARD_ARRANGED` coalescing (§7.4).
- [ ] **Fix:** `GraphService.mergeCaseGraph` must set `missing: true` on synthesized finding nodes whose finding row no longer exists. Today it builds them without the flag, so deleted findings can't be told apart from live ones (and `findingVisualState` depends on this).
- [ ] Hook `ensureItem` into `addEvidence`, thread create and auto-pull.
- [ ] OpenAPI + `bun codegen`. **Add the new DTO names to the `export type {…}` list in `packages/api-client/src/client.ts`**, because it's a selective re-export.

**Tests (jest, `apps/api/src/case-board/*.spec.ts`)**

```ts
describe('CaseBoardService.applyOps', () => {
  it('rejects item.delete on EVIDENCE and HYPOTHESIS items', async () => { /* … */ });
  it('rejects a link whose endpoint belongs to another board', async () => { /* … */ });
  it('rejects a findingId that is not attached to the endpoint evidence', async () => { /* … */ });
  it('link.promote writes a MANUAL edge once and is idempotent', async () => { /* … */ });
  it('soft-deletes links when an endpoint note is deleted, restores on item.restore', async () => { /* … */ });
  it('writes at most one BOARD_ARRANGED per actor per 5 minutes', async () => { /* … */ });
  it('rolls back the whole batch on an unexpected error, but not on BoardOpRejected', async () => { /* … */ });
  it('rejects writes on CLOSED cases with 409', async () => { /* … */ });
  it('rejects unknown keys (strictObject) with 400', async () => { /* … */ });
});
describe('CaseBoardService.getBoard reconcile (integration, real schema)', () => {
  it('creates one unplaced item per evidence and hypothesis, idempotently', async () => { /* … */ });
  it('soft-deletes items whose evidence was removed through the REST/MCP path', async () => { /* … */ });
});
```

**Acceptance:** all board writes work through `curl`/Swagger, and the timeline shows board events.

### Phase 2: Read-only board with evidence bubbles (L)

- [ ] `case-board.tsx` shell with the full-bleed page, top bar (title/status/severity/watches chip/drawer buttons as stubs), and the empty state.
- [ ] Store `hydrate` + `buildDomain` + projection (§8.3, §8.5), with unit tests for `buildDomain`, `resolveEndpoint` and `findingVisualState`.
- [ ] `EvidenceBubble`, `FindingRow`, `UnattachedRows` (attach via `finding.attach`), `BubbleChip`, LOD.
- [ ] `SystemEdge` (reusing `edgeClassOf`/`EDGE_CLASS_STYLE`), anchored edges, hover cards with 🔒, parallel-edge collapse, and re-routing for collapsed bubbles.
- [ ] Suggested ghosts + `SuggestedEdge` + *Pin to board* (`evidence.add`) + the auto-hide rule (> 30).
- [ ] Positions: drag → `moveItems` → persistence (§8.4). Auto-place + first-open ELK (§8.9).
- [ ] Collapse/expand per bubble (persisted `collapsed`).

**Playwright-ct tests (`apps/web/tests/components/case-board/*.spec.tsx`):**
- A bubble renders all six finding states with their chip text.
- In `chip` LOD a bubble renders only the name, and in `compact` it renders no rows.
- A collapsed bubble re-routes a row edge to the header.
- System edges have no delete affordance in the context menu.

**Acceptance:** opening an existing case shows every bubble, auto-laid out once, and a reload keeps positions. Parity with today's evidence, findings, NEW/GONE and system edges.

### Phase 3: Linking & hypotheses (L)

- [ ] Connectors on the header and rows, `ConnectionMode.Loose`, `isValidConnection`, `onConnectEnd` → `LinkPopover` (§5.4).
- [ ] `LinkEdge` (confirmed/suspected/contradicts, confidence width, label), link editing, *Promote to global relationship*, and 🌐 rendering for legacy MANUAL edges ("Delete everywhere" confirm → existing `DELETE /graph/edges/:id`).
- [ ] `HypothesisCard` + Hypothesis tool + `hypothesis.create` (with supports from the selection).
- [ ] `StanceEdge` + `stance.set/remove`. Delete the client-side `resolveTarget`.
- [ ] Hypothesis drawer (reusing `CaseThreads` entries, status, confidence).
- [ ] Hypothesis focus (click the card → focus set = its stance targets).
- [ ] Context menus for bubble, row, hypothesis, link, system edge and pane (§5.8), plus the `NodeToolbar`.

**Acceptance:** finding → finding link in **one drag + one click**. Hypothesis → evidence stance in one drag + one click. Nothing leaks into another case's board.

### Phase 4: Whiteboard primitives & undo (M–L)

- [ ] `NoteNode` (markdown, colors, `NodeResizer`, inline edit with `expectedUpdatedAt`).
- [ ] `FrameNode` (create by drag, rename, tint, resize, membership via `getIntersectingNodes`, collapse).
- [ ] Highlight for items and rows (§5.7). *Only highlighted* view.
- [ ] `CommentPin` + popover thread + `comment.create/resolve`, anchored to an item/row/point.
- [ ] Command stack: undo/redo for every command in this and earlier phases. Tests for inverse correctness (`forward` then `inverse` = identity on the domain).
- [ ] Tool dock + shortcuts (§5.14) + cheat sheet.

**Acceptance:** a user can build a readable board (frames, notes, highlights, comments), undo any of it, and it survives reload.

### Phase 5: Navigation & drawers; remove the tabs (M)

- [ ] ⌘K palette (on board / add to board / actions).
- [ ] Focus lock, Shift+click path (`shortestPath`), and the View popover (§5.10, persisted in `localStorage` with try/catch).
- [ ] Drawers: Timeline (activity + chronology + threads, with *Show on board*), Leads (drag onto canvas), Case file (details, conclusion, close), Inquiries, Evidence table (row → fly to), Details (asset/finding).
- [ ] Extend `case-timeline.tsx` renderers for every new `CaseActivityType`.
- [ ] Mini-map toggle, zoom controls, fit / zoom to selection.

**Acceptance:** every capability in the §4 map is reachable, and the tab strip is gone behind the flag.

### Phase 6: Async collaboration, snapshots, MCP (M)

- [ ] `CaseBoardGateway` + `useBoardSocket` + presence avatars + change toasts.
- [ ] Refetch on focus and every 60 s while visible. Merge keeps pending ops.
- [ ] Display-name prompt (`useActorName`) + `X-Actor-Name` on every api-client request (middleware in `@workspace/api-client` config).
- [ ] Stale-edit handling for notes and link labels (§5.12).
- [ ] Snapshots: automatic on `close_case`, manual from the overflow menu, a read-only viewer, and read-only mode for closed cases.
- [ ] MCP tools `get_case_board`, `apply_case_board_ops`, plus updated MCP instructions.
- [ ] If more than one API replica is deployed: socket.io Postgres adapter.

**Acceptance:** two browsers on the same case see each other's changes within 2 s, closing a case creates a snapshot, and an agent can add a note through MCP.

### Phase 7: Hardening & cut-over (M)

- [ ] Performance pass at 300 bubbles / 2k rows (§11 targets). Profile re-renders with React DevTools: no node should re-render on unrelated store changes.
- [ ] Accessibility: every node has an `aria-label`, keyboard selection (Tab through nodes, `Enter` opens details), focus rings, `prefers-reduced-motion` disables fly-to animation.
- [ ] i18n en/de complete.
- [ ] *Export PNG* of the viewport or the whole board (the React Flow "download image" pattern with `html-to-image`). Optional, see Q4.
- [ ] Playwright e2e: create case → add evidence via ⌘K → link two findings → add note → reload → all present → timeline shows 4 entries.
- [ ] Turn the flag on by default. After one release, **delete** `components/case-graph/*`, the case-specific paths of `graph-explorer` (`useClusterFocus` usage in cases), `AttachFindingsDialog`, `ManualEdgeDialog` usage from cases, the `caseGraph.*` i18n keys and `LegacyCaseWorkspace`.
- [ ] Docs: update `docs/` (user guide section "Case board") and this PRD's status.

### Phase 8 (future): Real-time with Yjs + Hocuspocus

Not in v1. The v1 design keeps it cheap:
- Items and links already have **client-generated UUIDs** and are addressed by id, so they map 1:1 onto `Y.Map<itemId, Y.Map>`.
- All mutations are `BoardOp`s. Each op becomes a small Y transaction, and the ops endpoint becomes Hocuspocus's `onStoreDocument` projection into the same tables (plus a `case_boards.ydoc bytea` column).
- Domain ops (`evidence.*`, `stance.*`, `hypothesis.create`, `comment.create`) stay on REST. Only view state moves into the Y doc.
- `Y.UndoManager` with `trackedOrigins` = the local client replaces the command stack.
- Needs a real user identity (Q1) for awareness and cursors.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Rows as handles inside a node: `handleBounds` are stale after a bubble grows or shrinks | Call `useUpdateNodeInternals(id)` after collapse, expand or show-all. Tested in Phase 2. |
| Interactive transaction timeouts (P2028) on big batches | ≤ 200 ops per batch, 15 s timeout, domain ops go through indexed paths, and the client splits bigger batches. |
| Reconcile writes on every GET | The inserts are `ON CONFLICT DO NOTHING` against a unique index, and the soft-delete is an anti-join on a PK, which is cheap at case scale. Revisit if a case has > 5k evidence. |
| Old MANUAL global edges confuse users ("why can't I delete this one normally?") | Show the 🌐 badge and the hover text "Global relationship · visible in all cases" with an explicit *Delete everywhere* confirm. |
| Worker-originated changes (auto-pull) don't push over the socket | Refetch on focus and on a 60 s interval (v1). Postgres adapter later. |
| Spoofable `X-Actor-Name` | Clearly interim (Q1). It's attribution, not authorisation, and demo-mode write protection is unchanged. |
| Static export / desktop build | `dynamic(..., { ssr: false })` as today. Web Worker URLs through `new URL(..., import.meta.url)` (the pattern `force-worker.ts` already uses). Smoke-test the desktop app. |
| Losing features in the rewrite | The §4 map is the acceptance checklist for Phase 5. |

## 11. Success metrics

| Metric | Today | Target |
|---|---|---|
| Steps to link finding → finding | ~6 (mode, click, click, dialog, select, submit) and the asset must be expanded | **2** (drag, pick) |
| Board layout survives reload | No | Yes, 100 % |
| Board open p95 (300 bubbles) | n/a | < 1.5 s |
| Pan/zoom at 300 bubbles | n/a | ≥ 50 fps (M1) |
| Cases with ≥ 1 note or comment (30 days after GA) | 0 (impossible today) | ≥ 40 % of active cases |
| Board edits visible to a second viewer | Only after a manual reload | < 2 s |

## 12. Open questions (owner to answer before the phase that needs it)

| # | Question | Needed by | Default if unanswered |
|---|---|---|---|
| Q1 | **Identity.** Is there an auth/user system on the roadmap? v1 uses a self-declared display name (`X-Actor-Name`). | Phase 6 | Display name in `localStorage` |
| Q2 | Viewport per user or shared? | Phase 2 | Per user (`localStorage`), not persisted on the board |
| Q3 | Snapshot retention: keep forever, or N per case? | Phase 6 | Forever (evidence preservation) |
| Q4 | Export formats for legal/remedial handover: PNG only, or also PDF and a JSON evidence bundle? | Phase 7 | PNG + JSON (the snapshot payload) |
| Q5 | Should autopilot agents be allowed to *move* items, or only add notes, hypotheses and suspected links? | Phase 6 | Add only. Agent-created items are placed by auto-place. |
| Q6 | React Flow attribution: keep the small "React Flow" link (MIT, free), or buy React Flow Pro to hide it? | Phase 0 | Keep attribution (remove `hideAttribution` from the snippet) |
| Q7 | Link-kind vocabulary: is the default list in §5.4 right for our users (DLP/compliance investigators)? | Phase 3 | Use §5.4 + remember custom kinds per namespace |

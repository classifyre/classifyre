# Harness Integration Audit

_End-to-end assessment of whether Classifyre's investigation pipeline holds together
from a typical data/software company's ingestion needs through to a real
investigation, all wrapped by the AI harness (autopilot)._

This document is the written deliverable for the "does it all integrate" question.
It records what is wired, what was gapped, and what this change set closed.

## The chain

```
Sources → Assets → Findings → Inquiries → Cases → Hypotheses → Fingerprints/Dedup → Linkage
                                   ▲                                                     │
                                   └──────────────── AI Harness (autopilot) ────────────┘
```

| Stage | Status | Where |
| --- | --- | --- |
| Sources (40+ connectors, scheduled scans) | Wired | `source.service.ts`, `cli-runner/` |
| Assets (catalog, JSONB metadata) | Wired | `Asset` model; no raw-content column — **metadata is the asset's shape** |
| Findings (deterministic `detectionIdentity`, status/history) | Wired | `findings.service.ts`, `utils/detection-identity.ts` |
| Inquiries (saved matchers over findings) | Wired | `inquiries.service.ts`, `matching/inquiry-matcher.ts` |
| Cases (evidence, findings, notes, activity log) | Wired | `cases.service.ts`, `case-activity.service.ts` |
| Hypotheses (stance-weighted support) | Wired | `hypotheses.service.ts`; newer `CaseThread` model coexists |
| Fingerprints / dedup (correlation, clusters, union-find) | Wired | `correlation/`, `duplicates-finder-agent.service.ts` |
| Linkage (generic `Edge` graph, BFS expansion) | Wired | `graph.service.ts` |
| Harness (5 missions, memory, system brief, audit) | Wired | `autopilot/harness/`, `autopilot/tools/` |

The chain is largely implemented. The autopilot wraps it via the INQUIRY, CASE,
CONFIG, DETECTOR_AUTHOR and DREAM missions, a long-lived memory store, and the
always-injected system brief.

## Gaps found — and what this change set closes

### 1. Cold start (CLOSED)

**Was:** DETECTOR_AUTHOR and CONFIG reasoned only off `findings.search`. A source
ingested **without detectors** produces **no findings**, so the harness had nothing
to act on and could not "add a detector by itself."

**Now:** new read tools `assets.profile` and `assets.sample` expose the ingested
assets' kinds and metadata shape. The DETECTOR_AUTHOR mission has a cold-start
step 0 (hypothesise a detector from asset metadata when `hasFindings` is false), and
CONFIG enables baseline detectors on detector-less sources. Both already run on a
scan regardless of finding count (gated only by the `autopilot*Enabled` flags in
`autopilot.worker.ts`).

### 2. Metadata not feeding the harness (CLOSED)

**Was:** only *finding* metadata reached the agents. Asset `metadata` (column names,
mime types, field shapes) — the realistic signal, since assets have no raw-content
column — was never exposed.

**Now:** `agent-search.service.ts` adds `sampleAssets()` (bounded, redacted per-asset
metadata preview) and `assetMetadataProfile()` (asset/source-type buckets, common
metadata keys, `hasFindings`). Asset metadata is now a first-class harness input.

### 3. System brief drift (CLOSED)

**Was:** the brief was a single free-form narrative the DREAM agent rewrote wholesale
every cycle, so it was "always different and not aligned," and it never incorporated
glossary/topics/memories or served a business user.

**Now:** the server **composes** the brief deterministically every render
(`system-brief.service.ts#compose/render`): fixed sections — Overview, Coverage,
Glossary, Topics, What's-been-tried/gaps, Setup & next steps — assembled from live
facts and agent memory. Only the short **Overview** is model-authored. The brief now
doubles as an operator setup guide (the Setup section is derived from instance state:
AI provider present, sources connected, cold-start sources, autopilot toggles).

## Residual gaps (documented, not addressed here)

- **Legacy `Hypothesis` vs `CaseThread`**: both models coexist; UI does not fully
  exercise thread entries/discussion threads.
- **`OPERATOR_DIRECTIVE` memory**: honored by DREAM but has no creation UI.
- **`DREAM` agent**: consolidates memory + writes the overview; no broader autonomy.
- **MCP tool dispatch**: discovery works; tool dispatch is partial.
- **Cross-finding linkage**: `Edge` supports finding→finding, but there is no UI to
  traverse it.

## How to verify

See the verification section of the implementation plan: API unit tests for brief
`render`/`compose`, `sampleAssets`/`assetMetadataProfile`, and a zero-finding cycle;
then an end-to-end run (source with no detectors → manual harness trigger → confirm
the detector-author/config agents used `assets.profile`/`assets.sample`, and the
`/harness` brief renders the fixed sections).

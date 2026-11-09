# Creating sources and configuring the first scan

## Contents

- [Creating a source](#creating-a-source)
- [The config that actually matters](#the-config-that-actually-matters)
- [Sampling: how to get coverage you can reason about](#sampling-how-to-get-coverage-you-can-reason-about)
- [Detectors: choose a small interpretable set](#detectors-choose-a-small-interpretable-set)
- [Rules that protect your investigative state](#rules-that-protect-your-investigative-state)

---

## Creating a source

For a local document corpus, use **`LOCAL_FOLDER`**. The path is resolved *where the scan runs*, not where you are: with the all-in-one Docker image that means the container-side path of a bind mount (`-v ~/corpora/matter-7:/data/matter-7:ro` → enter `/data/matter-7`), and on Kubernetes the `mountPath` the chart's `api.localFolders` gave it. A path that exists on your machine but was never mounted will simply find nothing.

Order of operations:

1. Create the source with its connection config.
2. **`test_source_connection` before scanning.** It returns per-source object counts and catches a bad path in seconds rather than after a failed run.
3. Validate the full config (`update_source` returns the normalised persisted config — read it back and confirm it is what you meant).
4. Only then scan.

Reading back the normalised config is worth the round trip. It is how you catch a field that was silently dropped or coerced.

## The config that actually matters

### `max_file_bytes` — set this before any PDF work

The default is **10 MiB**, and files above it are **truncated before parsing**, not skipped. A truncated PDF loses its EOF/xref and fails extraction in ways that look like a parser bug rather than a config problem. The first corpus had 42 files over 10 MiB.

Set **100 MiB** for a document corpus, and verify the large files actually extracted rather than assuming.

### File-type scope

Scope to what you intend to analyse. Note that scope is part of the source's identity now — see the scope-narrowing rule below.

### `rows_per_page`

The schema describes this as tabular-only. **It is not** — local-folder sampling uses it to bound `AUTOMATIC`, `RANDOM` and `LATEST` too (G-002, still open). If you read the schema and conclude you cannot bound a local-folder exploration, the schema misled you; the runtime honours it.

## Sampling: how to get coverage you can reason about

| Strategy | Behaviour | Use it when |
|---|---|---|
| `RANDOM` | **Seeded with 0** — re-running selects the *same* objects every time (G-003, still open) | One reproducible exploratory sample. Never for broadening coverage — it cannot. |
| `AUTOMATIC` | Progressive, non-repeating, cursor-based | Bounded coverage that advances each run |
| `ALL` | Every object in scope | Full corpus, and the only strategy where absence can imply deletion |

The trap: `RANDOM` looks like it broadens coverage across runs and does not. Use one `RANDOM` run for a reproducible baseline, then switch to `AUTOMATIC`.

`ALL` carries the deletion semantics — see below.

## Detectors: choose a small interpretable set

Prefer a few detectors you can reason about over broad coverage. The first run's set, which is a reasonable starting point:

1. **A GLiNER2 entity detector** — people, organisations, locations, dates, case numbers, document type. Entity extraction worked and was materially better than generic PII for names and legal entities.
2. **A REGEX detector** — Bates numbers, dockets, investigation references, emails. These produced the run's single best signal: exact cross-document recurrence.
3. **Built-in PII** — useful for recurrence, noisy on transcripts. Evaluate rather than assume.

Defer sentiment, toxicity, and generic ImageNet labels: they do not answer an investigative question.

**Lessons the first run paid for:**

- **Broad special-purpose entity labels hallucinate confidently.** Aircraft and financial-identifier labels fired at 0.99 confidence on Bates/production-number composites. A tight regex for aircraft tail numbers was worse — it matched `N3`, `N4`, `N10`. If a label is producing garbage, remove it; do not keep it and mentally discount it.
- **Test each detector before attaching it.** Create test scenarios and run them. A detector that errors in a test will error on every page of a real scan.
- **Validate locally** if `validate_detector_config` rejects a schema you believe is correct (G-001) — the validator is wrong.

## Rules that protect your investigative state

These exist because breaking them destroyed real evidence in the first run. Several are now fixed in the product, but the practice is still correct — and verifying the fix is part of your job (see `known-issues.md`).

### Never narrow a populated source's scope

Narrowing the path/prefix of a source that already holds assets used to retire every out-of-scope asset and auto-resolve its findings. A one-document experiment silently retired nine assets and dropped an active inquiry from 8 matches to 0.

**Now:** assets record a scope fingerprint; retirement requires a scope match; out-of-scope assets are retained and reported as `assetsOutOfScope`. **Verify this holds.** If you want a one-file experiment, still use a separate temporary source — cheaper than finding out the hard way.

### Freeze the detector set before the first scan

Adding a second custom detector to already-scanned assets used to auto-resolve the *first* detector's still-valid findings, because reconciliation keyed on run staleness rather than detector identity.

**Now:** resolution is scoped to detectors that actually completed on that asset (`detector_outcomes`). **Verify this holds.** If you need to compare detectors, clone the source and compare independently.

### A zero-result scan is a failed scan, not an empty source

An `ALL` scan that returns nothing used to match every asset in the source and wipe it. **Now:** guarded. **Verify this holds** — point a populated source at a bad path and confirm nothing is retired.

### Re-verify lifecycle after every run

Compare active/deleted assets, OPEN/RESOLVED/FALSE_POSITIVE findings, inquiry match counts, and retained finding IDs. Rematch inquiries explicitly after any reconciliation. Re-running the same deterministic sample should be finding-idempotent: the same findings keep their IDs and `firstDetectedAt`, and gain a new `lastDetectedAt`.

# Product Evaluation — Classifyre First-Use #2 (Enron Email Corpus)

Build: desktop v0.4.57 · 2026-07-18 · Operator: Claude (Fable 5) via MCP, REST fallbacks documented.
Companion documents: `investigation-protocol.md` (evidence ledger), `bugs.md`, `improvements.md`, `cases-and-findings.md`.

## The verdict, first

**Classifyre found real evidence this time — and the single most valuable detector was the one
the product could not test, while the product's flagship semantic layer was silently dead.**

The first-use run #1 verdict was *"an extraction engine with an investigation shell around it."*
This run earns an upgrade, with an asterisk: **the investigation shell now works** — inquiries
auto-track new scans, cases hold hypotheses with weighted evidence links, finding triage
(FALSE_POSITIVE with comments) survives rescans, and the lifecycle fixes that destroyed state
in run #1 all held. What has NOT changed: **the product still cannot tell you which of its
findings matter.** Every judgment call in this investigation — genuine vs. server-named-deathstar,
restatement text vs. Harley-Davidson prize — happened outside the product, by grepping the
original corpus. The difference is that this time the product gave me quotable, checkable leads
worth judging.

## Did it help identify meaningful cases? — Yes, twice

Two cases with verified evidence emerged in one session (see `cases-and-findings.md`):
Forney's ERCOT desk instructions ("DO NOT GO TO THE POOL… have him ramp up") and the
JEDI/Chewco/LJM restatement trail across five mailboxes. Both would stand up to a skeptical
reviewer, because every attached finding was verified against the original files.

Credit where due: the **LLM detector produced the best evidence** — quoted passages, named
people, one-line rationales. Its `document_destruction` hit (the 2001-10-26 litigation hold,
sitting in Forney's Deleted Items) is exactly the kind of item an investigator wants surfaced.
The **REGEX detector's SPE codenames** delivered the promised cross-document recurrence signal
(28 inquiry matches across 5 mailboxes, growing automatically as scans complete).

## What was most useful

1. **LLM semantic detector** (via provider API): highest signal-per-finding of anything in the product. Also the only "semantic" capability that actually functioned.
2. **Exact-name REGEX + standing inquiries**: cheap, fast (~0.5 s/page), auto-growing match sets. The recurrence workhorse.
3. **Run honesty surfaces** (new since run #1): WARNING statuses, `textCoverage` histograms, `assetsWithoutText`, per-asset REST progress. I always knew what had actually been scanned. This is a real, field-verified improvement.
4. **Case scaffolding**: hypotheses with SUPPORTS links and weights, dated chronology events with finding citations, inquiry↔case linking. Adequate and pleasant via MCP.
5. **Runner logs at INFO level**: per-detector per-page timings with matched values — debugging and cost analysis came straight from them.

## What was ineffective or broken

1. **Semantic search: dead on arrival (B-5).** 115,887 chunks stored, **zero embedded** — a packaging defect (missing transformers dependency), compounded by a health endpoint that reports perfect health and a hybrid mode that silently degrades to lexical. Where semantic functionality was supposed to add value, it added a false sense of coverage. Where it produced misleading results: every `semantic_query` quietly returned name-substring matches while claiming to have run.
2. **File-level granularity on email corpora.** One asset = one 46k-line JSON of thousands of emails. Findings carry offsets relative to an *unrecorded* 100-line page, so the product cannot show you the email a finding lives in; the case graph's "evidence neighbourhood" is the entire mailbox's phonebook. This is the deepest product-fit problem and it taxes every other feature.
3. **The performance wall.** GLiNER+LLM tier: ~6 s/page warm → one small mailbox ≈ hours, the corpus ≈ never. The product neither warns you nor helps you tier detectors; I discovered the wall by watching one asset process for 75 minutes.
4. **Severity.** Every CRITICAL in the run was a suite-number+phone string labeled CREDIT_CARD at confidence 1.0. Run #1's lesson, replicated verbatim on a different corpus. Severity still ranks attention it has not earned.
5. **Detector testing for LLM detectors (B-1)**: silently impossible — the test path never injects credentials and reports empty FAIL with no error. I shipped the detector on faith and got lucky.

## Trustworthiness of findings

- Detector *extractions* were faithful: every spot-checked matched value existed verbatim in the source files (tabs and all). Ingestion fidelity PASS.
- Detector *labels* were not trustworthy without review: 0/4 California-scheme regex hits, 0/7 CREDIT_CARDs, 1/1 "shredding" were false positives. The LLM labels fared far better (5/5 reviewed genuine) but with chunk-overlap duplicates.
- **Verification against the source corpus was always possible and always necessary.** The product's own drill-down (page anchors, context snippets) is too weak to verify without leaving the product — grep was a mandatory companion tool.

## The autopilot, audited

Genuinely improved since run #1. It independently reached my own CREDIT_CARD-false-positive
diagnosis, disabled the offending pattern, authored a sane single-pattern SPE detector,
triggered a verification rescan, and tagged its memories `pending-verification` — and its
hypothesis was then cleanly disproven by its own rerun (the term "SPE" doesn't occur in that
mailbox), which is exactly how the loop should work. Summaries matched persisted decisions.
Two caveats: it silently mutated an operator-authored source config minutes after I saved it
(no consent or notification surface), and it acts by default on a fresh instance — attribution
noise for anyone doing controlled work.

## Communication patterns / account structure

Modestly helpful: source-per-account structure plus GLiNER person/org extraction gives a who's-who,
and phone-number recurrence links custodians. But real communication-pattern analysis (from/to
graphs, threading) is out of reach while emails are not first-class objects — the corpus's
from/to/cc/date fields are ingested as opaque JSON text, not metadata.

## Why it succeeded where it succeeded

Everything that worked — LLM quotes, exact-name recurrence, honest runs, durable triage —
shares one property: **it produces claims small and concrete enough to check.** Everything that
failed — semantic health, severity, graph neighbourhoods, counters — asserts something the
system does not actually know. The product's next step is not more extraction; it is making
every surfaced item carry its own verifiable context (the email, the date, the snippet), so the
judgment loop that today runs through grep can run through the product.

## Scorecard vs. run #1

| Dimension | Run #1 (Epstein) | Run #2 (Enron, v0.4.57) |
|---|---|---|
| Meaningful cases produced | 0 | 2 (verified) |
| Lifecycle safety (scope/detector changes) | destroyed state | **held (verified)** |
| Run honesty | lied (green + broken) | **honest (WARNING + coverage)** |
| Counters | wrong | **still wrong on first runs (B-4 regression)** |
| Semantic layer | n/a | **dead, silently (B-5)** |
| Severity as a guide | misleading | still misleading |
| Autopilot trustworthiness | false memories | **verifiable, sensible; consent gap** |
| Judgment (what matters) | absent | still the operator's job — but now fed with checkable leads |

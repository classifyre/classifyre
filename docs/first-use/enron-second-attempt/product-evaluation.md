# Product Evaluation — Classifyre Second Validation Attempt (Enron Corpus)

Build: Classifyre desktop **v0.4.60** · 2026-07-19 · Operator: Claude (Fable 5) via MCP, REST
fallbacks documented. AI Autopilot enabled throughout.
Companion docs: `investigation-protocol.md` (evidence ledger), `bugs.md`, `improvements.md`,
`cases-and-findings.md`, `autopilot-evaluation.md`.

## The verdict, first

**The plumbing the first attempt reported broken is now largely fixed — semantic search runs,
counters are honest, lifecycle state survives — but the one detector that turns this corpus into
cases (the LLM conduct screen) silently fails at scan scale, and the autopilot will overwrite your
configuration while you work.** The product has moved from "an extraction engine with an
investigation shell" to "a working investigation shell whose most valuable analytic tier is
unusable at scale and whose autopilot is not yet safe to leave unattended."

The single question the report must answer — *did the software help me find and substantiate
something, or did it hand me text and leave the judgment to me?* — has a sharper answer this time:
**it helped me substantiate a cross-custodian regulatory thread** (Case 1, FERC/Bracewell &
Patterson across three mailboxes, verified at source) using exact-recurrence signal and an
autopilot-authored inquiry. But the judgment — which of 17,000+ findings mattered, which CRITICALs
were phone-number artifacts — was still entirely mine.

## Compared with the first attempt

| Dimension | First attempt (v0.4.57) | Second attempt (v0.4.60) |
|---|---|---|
| Semantic layer | **dead, silently** (0 embeddings, health lied) | **works** — MiniLM-384d, embeddings populate, vector search returns ranked results (B-5 FIXED) |
| First-run counters | wrong (`assetsCreated:0`) | **correct** (`assetsCreated:100`) (B-4 FIXED) |
| Run honesty | improved | **works in field** — WARNING + textCoverage named a real corrupt-file failure |
| LLM detector test path | silent no-op (B-1) | **executes** the model (B-1 FIXED) — but comparator shape mismatch causes false FAIL (BUG C) |
| Lifecycle safety (detector-set change) | held | **holds** — findingsRetained, FP status survived (G-021 + FP preservation verified) |
| LLM detector at scan scale | worked on one small mailbox | **fails silently** — 100% call rate-limit, errors swallowed to OK (BUG A) — regression in usable capability |
| Email-level evidence traceability | **absent** (whole mailbox = 1 asset) | **present** — 1 file = 1 asset, findings point to individual emails/attachments |
| Autopilot trustworthiness | verifiable, consent gap | provenance **improved**, but **overwrites operator config** (BUG F) + **cross-namespace leak** (BUG D) |
| Severity as a guide | misleading (CREDIT_CARD) | **still misleading** (UK_NHS on phone numbers) |
| Meaningful case produced | 2 (verified) | 1 (verified, independent thread) |

## What was most useful

1. **Exact cross-document recurrence** (ORGANIZATION values via `get_value_occurrences` + standing
   inquiries) — again the cleanest, most defensible signal. It carried Case 1.
2. **Run-honesty surfaces** — WARNING/textCoverage/detector_outcomes told me exactly what was
   scanned and what failed; the corrupt-xls WARNING was correct and specific.
3. **Semantic vector search** — now functional; useful for *finding* thematically-related documents
   ("electricity trading positions" → the right spreadsheets) even though it returns no snippet to
   verify with (a gap).
4. **File-level granularity** — because ingestion is now 1-file-1-asset (the JSON indexes are gone),
   findings are traceable to a specific email or attachment. This fixes the first attempt's deepest
   product-fit complaint, though it's partly a consequence of the corpus change, not only the product.
5. **Lifecycle durability** — my false-positive mark and all other-detector findings survived a
   detector-set-change rescan. Triage work is safe now.

## What was ineffective or broken

1. **LLM conduct detector at scale (BUG A)** — the highest-value analytic tier produced **zero**
   findings on 100 assets because every provider call was rate-limited and the errors were swallowed
   to `OK`. Throttling to one worker reduced but did not eliminate the failures (the detector is also
   double-listed per asset, BUG B, doubling calls). This is the decisive limitation: the tool that
   would substantiate *conduct* cases cannot run across the corpus.
2. **Autopilot config hijack (BUG F)** — it overwrote my saved detector selection in a 13-second
   race and ran its config on my manual run. Detector selection is not reliably operator-controlled.
3. **Severity** — every CRITICAL was a UK_NHS recognizer artifact on US phone numbers. Run #1's
   lesson, replicated on a new recognizer.
4. **PII ORGANIZATION precision** — real orgs mixed with "Definitive Agreement"/"Grand Total"/
   newline-glued spans; requires review before use.
5. **Semantic results are unverifiable in-product** — no snippet, chunk-ref, or score returned.

## Semantic functionality — deliberately tested

- **Operational?** Yes. `/embeddings/status` reports a registered worker, growing `embeddedRows`,
  draining `pendingEmbedJobs`, 0 failures. DB `content_embeddings` grows during scans. (First attempt
  this was entirely dead and the health endpoint lied — the single biggest fix in this build.)
- **Genuinely semantic or silent lexical fallback?** Vector-mode returned relevant documents whose
  names/text did not contain the query terms (a positions query surfaced "West position1006.xls" and
  ENA spreadsheets), so it is doing embedding similarity, not substring matching.
- **Verifiable?** Not from the product — results carry no snippet/score. I could only confirm
  relevance by opening the assets myself.
- **Coverage while draining:** vector search saw ~176 of ~435 chunked assets mid-backfill; partial
  but honestly reported.

## Trustworthiness of findings

- **Extraction fidelity: PASS.** Every spot-checked extracted value (the FERC filing tracker phrases)
  existed verbatim in the source `.doc`.
- **Labels: not trustworthy without review.** UK_NHS 0/3, ORGANIZATION low precision. LLM labels were
  excellent *when they ran* (0.99, quoted evidence) but they almost never ran at scale.
- **Verification against source was always necessary** — the exact-recurrence + source-grep loop is
  still the real investigation; the product surfaces candidates.

## Why it succeeded where it succeeded

Everything that worked shares the first attempt's property: **it produces claims small and concrete
enough to check** — an exact org value recurring across mailboxes, a WARNING naming a corrupt file, a
retained finding ID. Everything that failed asserts something the system cannot stand behind: a
CRITICAL severity, an `OK` detector outcome that hides 100% provider failure, an autopilot config
change with no consent. The gap between "the shell works now" and "the product tells you what
matters" is the LLM tier — and that tier is exactly what silently breaks at scale.

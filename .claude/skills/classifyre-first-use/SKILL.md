---
name: classifyre-first-use
description: Run a real investigation against a live Classifyre instance (via MCP, REST as fallback) to find out whether the product actually helps an investigator — then write the evidence ledger and blunt retrospective. Use this whenever asked to do a first-use run, field test, dogfood run, real-usage test, dry run, or "try the product on a real corpus"; whenever asked to investigate a document corpus with Classifyre and report what worked and what didn't; and whenever asked to re-run or extend a previous first-use protocol. Also use it when asked to verify that shipped remediation fixes actually hold in real usage, since it carries the regression watch list and the known-open issues.
---

# Classifyre First-Use Investigation

## What this actually is

You are running a **real investigation** on a real corpus. The product assessment falls out of that — it is not the goal you optimise for.

This distinction decides whether the run is worth anything. The first run produced 68,987 findings across 4,235 assets and its own retrospective concluded:

> The core problem is not lack of extraction. The core problem is judgment. Classifyre can surface candidates, but it does not consistently separate real investigative leads, generic legal text, OCR noise, duplicate or recycled values, and detector false positives.

An agent that sets out to "test the software" produces exactly that outcome again: a large pile of extraction and a shrug. An agent that sets out to **answer an investigative question** discovers where the tool helped and where it got in the way, because it needs the tool to work.

So: pick a question the corpus could plausibly answer. Pursue it. Notice what the tool did for you and what you had to do yourself. That noticing is the deliverable.

**The single question your report must answer:** did the software help you find and substantiate something, or did it hand you text and leave the judgment to you? Answer it honestly. "It extracted a lot" is not an answer.

## Before you touch anything: record the build

Write the exact version and commit of the instance under test into the ledger, first line.

This is not bookkeeping. In the first run, correlation reported a 4,546% duplicate score. Months later that could not be reproduced — the scoring is mathematically bounded at 1.0 and the values are deduplicated by a unique constraint. It took a Postgres-level reproduction to establish that the tested instance had simply been running a pre-fix build. **A symptom you cannot attribute to a build is close to worthless.** Every hour spent chasing it was avoidable.

```
Build under test: v0.4.55-SNAPSHOT (commit 300b909e, branch develop)
Recorded: <timestamp>
```

If you cannot determine the build, say so explicitly in the ledger and treat every finding as provisional.

## Start from an empty instance

Use a fresh workspace (or a reset instance). Then record a baseline: sources, assets, findings, runs, detectors, inquiries, cases, autopilot state.

Resuming against a populated instance costs you attribution — you can never cleanly say "this run produced X", which is precisely what made the counter bugs so hard to pin down. The baseline is what lets you say "the instance had 0 findings; after this action it had 439" and have that mean something.

## Interface policy: MCP first, REST when blocked

Drive everything through MCP. When MCP cannot express what you need, fall back to the documented REST API — **and record the fallback as an MCP coverage gap in the ledger**. The fallback is not the finding; the fact that you needed it is.

`references/environment.md` has the connection details (how to resolve the API base URL for the deployment you are pointed at), the MCP/REST surface split, and the known blockers with their workarounds. Read it before you start.

## The protocol

Work in this order. It is not arbitrary — each phase produces the evidence the next one needs, and the ordering avoids traps that cost the first run real investigative state.

### 0. Baseline and corpus profile

Read the empty instance. Then **profile the corpus locally before ingesting anything**: file count, size, types, and what the documents actually are. Sample the text layer of a few files per dataset.

This was one of the few unambiguously valuable things the first run did. It told the operator that some datasets were single-page photographic scans that would stress OCR, and that one small dataset held rich multi-page transcripts — which is how they picked a sensible first slice instead of guessing. It also separates claims about the corpus (from the corpus) from claims about the product (from the product).

### 1. Configure one small, rich slice

Pick the smallest dataset with genuinely rich text. Configure detectors **before the first scan and do not change the set afterwards**. Validate and test each detector before attaching it.

`references/source-setup.md` covers creating sources, the config that actually matters, and the traps — several of which will silently cost you data if you get them wrong.

### 2. Bounded first run, inspected properly

Run it. Then inspect: assets, findings, per-asset progress, run status, counters, and the detector-specific log lines.

**Do not read `COMPLETED` as success.** A run can be green while a detector failed on every page. Newer builds surface this (`detector_outcomes`, `WARNING` status, `assetsWithoutText`) — verify those signals actually fire, because they are recent and unproven in the field. See `references/known-issues.md`.

### 3. Judge the findings before building on them

Look at what came back and decide what is evidence and what is noise. This is where the first run's value collapsed, so spend real effort here.

What earned its place last time:
- **Exact cross-document recurrence.** The same docket or investigation reference appearing in multiple files was the cleanest, most defensible signal the product produced.
- **Manually reviewed entity hits.** A subset of person/organisation/location/case-reference hits were useful *after* checking them against the source text.

What did not:
- Generic PII (dates, names) — too common to mean anything.
- High-severity recognizer hits without source review. Every `CRITICAL` in the first run was a `CREDIT_CARD` match on repeated-digit OCR artifacts. A label is not proof.
- Duplicate clusters and correlation scores as a ranking signal.
- Anything the autopilot wrote into memory.

Severity is a claim about the *label*, not about evidence quality. Do not let it rank your attention.

### 4. Investigate

Build the thing the corpus supports: inquiry → case → hypothesis → evidence → support links → graph → timeline. Prefer exact identifiers for standing inquiries; avoid broad transcript PII matchers.

Then ask the question that matters: **did the tool help you get here, or did you get here despite it?**

### 5. Expand

Only once the bounded slice is understood. Raise scope deliberately and re-verify lifecycle after every run: active/deleted assets, finding statuses, inquiry match counts, retained IDs.

### 6. Autopilot last, and steered

Evaluate the agents only after you have a trustworthy manual baseline, so you can tell what they actually changed. Treat their memory and their summaries as claims to verify, not facts. Verify every claimed action against persisted state — `decisionCount` and a direct state diff, not the summary string.

### 7. Audit and write it up

Reconcile what you believe against what the instance holds. Then produce both deliverables.

## Evidence discipline

Every production-changing action gets recorded: **interface used, input intent, returned ID/state, follow-up verification.** Claims about the corpus come from the corpus. Claims about the product come from production responses or run logs — not from what you expected to happen.

Use this vocabulary consistently (it is what makes the ledger scannable):

| Status | Meaning |
|---|---|
| **PASS** | Observed working, verified from returned state |
| **FAIL** | Valid in-scope request, wrong result or error |
| **GAP** | Capability absent, misleading, or cannot express what is needed |
| **WORKAROUND** | Another interface unblocked it; the gap remains |
| **OPEN** | Not yet tested with sufficient evidence |
| **RISK** | Code/config suggests a failure mode; runtime evidence inconclusive |

Distinguish **blocked** from **broken** from **absent**, and say which:
- *Blocked* — the path exists but something stopped you (timeout, auth, a validation error on a valid input). Record what you tried and what unblocked it.
- *Broken* — it ran and produced a wrong result.
- *Absent* — the capability does not exist on this interface.

When something you expected to work didn't, record the expectation too. "I expected X because Y; got Z" is far more useful to the next reader than "Z". Half the first run's most valuable entries are of exactly this shape.

## What to pay attention to

`references/known-issues.md` is the highest-value read in this skill. It carries:

- **The regression watch list** — bugs fixed since the first run, what the new signal looks like, and what to verify. These fixes are recent and largely unproven against a real corpus. If one has regressed, that is the most important thing you will find.
- **Known-open issues** — do not spend the run rediscovering these. Confirm and move on.
- **Known blockers with workarounds** — so you lose minutes, not hours.

Read it before Phase 1, and again before you write anything up.

## Deliverables

Two documents. Keep them separate — the ledger is a durable evidence record, the retrospective is an argument. Mixing them blunts both.

1. **Protocol / evidence ledger** — baseline, strategy decisions, the observation and gap ledger, the production action ledger, capability gates, completion audit, and the investigative result at handoff.
2. **Blunt retrospective** — what worked, what didn't, why a case did or didn't emerge, what was valuable, what wasn't, and the concrete failures to fix first.

`references/deliverables.md` has the structure and templates for both, taken from the first run.

The retrospective is where you are allowed — required — to be blunt. Its predecessor's verdict was *"the software is an extraction engine with an investigation shell around it"*, and that sentence was worth more than the 68,987 findings. If the product still deserves that, say so. If it has earned better, show why with evidence. Write for the developers, not for a stakeholder.

## Two failure modes to avoid

**Reporting activity as outcome.** "Seven sources scanned, 4,235 assets, 68,987 findings" describes work, not value. The reader wants to know whether any of it mattered.

**Rediscovering known bugs and calling it a finding.** Check `references/known-issues.md` first. Novel information is what justifies the run.

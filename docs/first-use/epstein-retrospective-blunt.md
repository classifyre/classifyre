# Classifyre Epstein Corpus Retrospective

Started: 2026-07-15

This is the blunt version. It is written for software development, not for a polished investigation memo.

## Bottom line

The software helped extract a large amount of text, findings, and cross-source signals. It did not reliably tell us what was actually important.

The core problem is not lack of extraction. The core problem is judgment.

Classifyre can surface candidates, but it does not consistently separate:

- real investigative leads,
- generic legal text,
- OCR noise,
- duplicate or recycled values,
- and detector false positives.

That is why we ended with only a small number of defensible leads and no strong, obvious investigation case.

## What Worked

The following parts were useful and should be kept.

1. Source ingestion and runtime execution worked at scale.

   The configured production sources all ran to completion. The full-corpus pass covered 4,235 active assets across the configured datasets and finished cleanly.

2. Exact recurrence across sources was real and useful.

   Shared legal references and repeated identifiers did identify concrete cross-document connections. That is the main thing the software did well.

3. The system could keep a durable record of findings, cases, hypotheses, and support links.

   Once a finding was manually confirmed, it could be pulled into an inquiry or case and linked through the graph and timeline.

4. The protocol and audit trail were strong.

   The investigation history was documented in a way that makes later review possible. That matters because the platform itself was not good at explaining why a result mattered.

5. Manual review could still rescue value from noisy output.

   A few exact-reference findings and one cross-source phone-value lead were worth keeping after human review.

## What Did Not Work

This is the important part.

1. The extraction layer produced far more noise than judgment.

   Most of the output was generic:

   - dates,
   - names,
   - docket patterns,
   - Bates numbers,
   - legal boilerplate,
   - OCR fragments,
   - built-in PII hits,
   - and duplicate clusters.

   That is not enough to form a case by itself.

2. OCR coverage was weak in a way that was easy to miss.

   Empty OCR outputs were logged, but they did not show up as asset errors. That means the run could look healthy while still missing text from a meaningful amount of material.

3. The severity model overstated importance.

   Some `CRITICAL` findings were built-in recognizer hits that looked like repeated-digit strings or OCR artifacts. Severity labels were not a reliable signal of evidentiary value.

4. Correlation was not trustworthy enough to drive decisions.

   Duplicate scoring inflated badly. Scores over 100% and absurd shared-value counts made it clear the scoring logic was not a clean measure of similarity.

5. Autopilot memory was not dependable as a source of truth.

   It wrote false summaries such as “no findings” after the corpus already had substantial evidence. That is a serious problem because a downstream agent can use those memories as if they were verified facts.

6. Summary counters were misleading.

   Several agents reported “applied” work even when the persisted decision count was zero. That makes the logs hard to trust.

7. Some agent behavior was plainly confused.

   One case review used the wrong detector key/version mental model and searched a nonexistent detector name instead of the stable detector key. That is a tooling and UI problem, not just user error.

8. Scope handling was dangerous.

   A narrow one-document run caused out-of-scope assets to be retired from the active set. That is a product defect with real investigative impact.

9. Denormalized inquiry counters were wrong.

   Inquiry match counts and new-match counts did not match the actual match endpoint. That breaks trust in the platform immediately.

10. Logs were noisy enough to confuse automation.

   Error-like lines included model load progress, compatibility messages, and platform warnings that did not represent actual run failure. This makes automatic health interpretation bad.

## Why No Strong Case Emerged

The short answer is that the corpus did not hand us a case. It handed us lots of text.

The platform can extract values, but it cannot prove significance. That distinction matters.

What we actually got:

- repeated names,
- repeated dates,
- repeated legal references,
- repeated docket strings,
- repeated location strings,
- repeated OCR artifacts,
- and a few exact-value recurrences across files.

What we did not get:

- a clean chain from extracted values to a concrete allegation,
- a strong witness statement,
- a direct action/evidence sequence,
- a high-confidence hidden relationship,
- or a clear event that demanded escalation.

So the failure is not “nothing was found.”

The failure is “the software could not tell which findings were merely data and which findings were actually investigative.”

## What Was Valuable

These were the only kinds of output that consistently mattered.

1. Exact cross-document recurrence.

   When the same exact reference appeared in multiple files, it was worth attention. This includes legal references and a few exact-value recurrences.

2. Manually reviewed entity hits.

   A subset of person, organization, location, and case-reference hits were useful when reviewed against the source text.

3. Evidence that could be linked, not just listed.

   Support links, case evidence, timeline events, and graph nodes were useful once the underlying finding was actually worth keeping.

4. Reconciliation artifacts.

   The software’s repair behavior exposed bugs, but it also showed which records were durable and which were just transient runtime noise.

## What Was Not Valuable

These should not be treated as investigative value on their own.

1. Generic PII output.

   Dates, person names, and broad legal entities by themselves were too common to be useful.

2. Built-in credit-card or other high-severity recognizer hits without source review.

   A label is not proof. Some of these were obviously OCR-like repeated digits or pattern matches that should never have been escalated automatically.

3. Duplicate clusters and correlation scores.

   The scoring was too broken to trust as a ranking signal.

4. Autopilot “memory” summaries.

   These were often stale, wrong, or based on an incomplete snapshot of the state.

5. Run totals described as if they were new discoveries.

   Several counters were really “current persisted set” numbers, not creation counts. That distinction matters and was not clear enough.

## Practical Diagnosis

The platform is good at this:

- ingesting documents,
- extracting text,
- producing many candidates,
- preserving state,
- and letting a human inspect what exists.

The platform is bad at this:

- deciding what is important,
- explaining why a finding matters,
- assigning trustworthy confidence,
- preventing noisy false positives from looking serious,
- and giving truthful operational summaries.

So the software is an extraction engine with an investigation shell around it.

It is not yet an investigation system in the sense of “this will help me understand the case without a lot of manual cleanup.”

## Concrete Failures To Fix

These are the specific product issues that should be addressed first.

1. Empty OCR must become a first-class signal.

   If OCR returns nothing, that should be visible in asset progress, status, and corpus coverage. Right now it is easy to miss.

2. Severity must be separated from evidence quality.

   High or critical labels should not be read as “important for the case” unless the platform can justify it with context.

3. Duplicate scoring must be rebuilt.

   Correlation should index normalized values once per asset, not inflate from repeated page entities or repeated finding emission.

4. Inquiry counters must be fixed.

   `matchCount`, `newMatchCount`, and actual `/matches` results must agree.

5. Detector identity must be clearer.

   Stable key, detector ID, and catalog version need to be obvious and impossible to confuse.

6. Run summaries must distinguish reads from mutations.

   “Applied” should mean applied. If the agent only read or reasoned, the summary should say that.

7. Scope changes must never silently delete active coverage in a populated source.

   Narrowing a source for a test run must not destroy prior active scope unless that is explicitly requested and clearly previewed.

8. Autopilot memory must be labeled as untrusted until verified.

   If the agent writes a source profile from stale or partial state, that memory should not be treated as evidence.

9. Logs need clean severity semantics.

   Operational noise should not be reported as `ERROR` unless it is actually a failure.

10. The UI needs a stronger evidence hierarchy.

   Users should be able to see at a glance which findings are:

   - exact matches,
   - probable leads,
   - weak heuristics,
   - OCR fragments,
   - or known false positives.

## What I Would Tell the Dev Team

If this is going to be useful for real investigations, the product needs a sharper ranking model and stricter evidence handling.

My blunt recommendation:

- keep extraction broad,
- make evidence confidence much stricter,
- expose coverage and OCR quality clearly,
- stop over-trusting correlation scores,
- and treat autopilot summaries as advisory, not authoritative.

Right now the system is too willing to look confident about low-value output.

That is the wrong failure mode for investigative software.

## Best Leads We Actually Kept

These were the strongest practical leads from the whole history.

1. Exact legal reference recurrence across multiple PDFs.

   This was the cleanest signal and the easiest one to defend.

2. Docket/reference recurrence across multiple documents.

   Also defensible, but still needs source review before it becomes a narrative.

3. The exact phone-value recurrence across two datasets.

   Worth retaining as an unverified lead only. It is not proof of relationship or identity.

Everything else was either too noisy, too generic, or too broken in scoring to trust without manual review.

## Final Judgment

The software did help, but not in the way a user would hope.

It helped with:

- collection,
- extraction,
- search,
- linkage,
- and preservation.

It did not help enough with:

- relevance,
- confidence,
- explanation,
- and case selection.

That is why the output did not become a strong inquiry or case.

If you want the product to be genuinely useful for this kind of work, the next step is not “extract more.” The next step is “rank and explain better.”

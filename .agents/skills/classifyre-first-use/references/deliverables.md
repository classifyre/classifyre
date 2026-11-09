# Deliverables: the ledger and the retrospective

Two documents, written for developers. Keep them separate: the ledger is a durable evidence record you can return to in six months; the retrospective is an argument about whether the product works. Mixing them blunts both.

Write them under `docs/first-use/` alongside the previous run's.

## Contents

- [Document 1: the protocol / evidence ledger](#document-1-the-protocol--evidence-ledger)
- [Document 2: the blunt retrospective](#document-2-the-blunt-retrospective)
- [What made the first run's docs good](#what-made-the-first-runs-docs-good)

---

## Document 1: the protocol / evidence ledger

```markdown
# Classifyre First-Use Investigation Protocol: <corpus>

Started: <timestamp>
Build under test: <version, commit, branch>       ← first, always
Environment: <base URL, deployment kind, workspace, MCP/REST posture>
Operator: <agent> via Classifyre MCP, REST as documented fallback

## Purpose
<the investigative question, and what this document is: the durable evidence ledger>

## Evidence and status vocabulary
PASS / FAIL / GAP / WORKAROUND / OPEN / RISK  — define them; readers rely on it

## Baseline
### Production instance
| Object | Count/state | Evidence |
<the empty instance, so every later number is attributable>

### Local corpus
<file count, size, types, per-dataset character from direct sampling —
 claims about the corpus come from the corpus>

## MCP capability map
<what MCP covered; what needed REST. Each REST fallback is a coverage gap.>

## Strategy decisions
### D-001 — <decision>
<what you chose and why, with the evidence that informed it>

## Observation and gap ledger
| ID | Status | Observation | Evidence / impact | Workaround / next verification |
<the core. O-nnn for observations, G-nnn for gaps.>

## Regression watch results
| Prior bug | Verdict on this build | Evidence |
<explicitly: did the shipped fixes hold?>

## Production action ledger
| Time | Action | Interface | Result | Verification |
<every production-changing action: interface, intent, returned ID/state, verification>

## Capability gates
- [ ] <the things that had to work for the run to mean anything>

## Completion audit
| Requested outcome | Authoritative evidence | Result |

## Investigative result at handoff
<what the instance holds, what the evidence supports, what remains unproven>

## Safe repeatable protocol
<what the next operator must do or avoid, learned this run>

## Product-fix priority
<ordered, with the reason each one matters>
```

### Ledger entry craft

A good entry lets a developer act without asking you anything. Compare:

> ❌ `| G-0xx | FAIL | Correlation is broken. | Scores were wrong. | Fix correlation. |`

> ✅ `| G-016 | FAIL | Correlation inflates shared-value counts and can create false duplicate links with impossible scores over 100%. | First REGEX-only run reported 3,808 shared Bates numbers and a 45.46/4,546% match between two PDFs although only 427 Bates findings exist globally. Retry still reported 128 shared and 135%. | Do not trust duplicate clusters from this run. Exact reverse-index occurrences remain verifiable. Correlation must index the finding's own normalized value once, or deduplicate (asset,label,valueHash) before scoring. |`

The second names the interface, gives reproducible numbers, states the blast radius, and proposes a mechanism. That entry drove a real fix.

Record your **expectation** when something surprised you: "I expected X because Y; got Z." Some of the first run's most useful entries are exactly that shape — the gap between the documented contract and the runtime is itself the bug.

---

## Document 2: the blunt retrospective

```markdown
# Classifyre <corpus> Retrospective

Started: <date>
Build under test: <version, commit>

This is the blunt version. It is written for software development, not for a
polished investigation memo.

## Bottom line
<Three sentences. Did the software help you investigate? Lead with the answer.>

## What Worked
<numbered, specific, with the evidence>

## What Did Not Work
<the important part. numbered, specific, with the evidence.>

## Why a case did / did not emerge
<the honest causal account>

## What Was Valuable
## What Was Not Valuable

## Practical Diagnosis
The platform is good at: …
The platform is bad at: …

## Concrete Failures To Fix
<ordered. each one actionable.>

## Regression check
<did the shipped fixes hold? name the build.>

## What I Would Tell the Dev Team
<the blunt recommendation>

## Best Leads We Actually Kept
<what survived review, and what each is worth>

## Final Judgment
```

### Be blunt

This document exists to say the thing a status report would soften. Its predecessor's verdict:

> The software is an extraction engine with an investigation shell around it. It is not yet an investigation system in the sense of "this will help me understand the case without a lot of manual cleanup."

and

> Right now the system is too willing to look confident about low-value output. That is the wrong failure mode for investigative software.

Those two sentences were worth more than the 68,987 findings. If the product still deserves them, say so. If it has earned better, show why with evidence — not with volume.

Do not pad it. Do not lead with what worked out of politeness. Lead with the answer to "did this help?"

---

## What made the first run's docs good

Worth preserving, per the retrospective's own assessment:

> The protocol and audit trail were strong. The investigation history was documented in a way that makes later review possible. That matters because the platform itself was not good at explaining why a result mattered.

Specifically:

- **Every production action recorded with its interface and verification.** This is what let a later reader reconstruct what happened and separate product behaviour from operator error.
- **Numbers attached to claims.** "1,377 PII findings: 879 dates, 312 persons, 186 locations" is checkable. "PII was noisy" is not.
- **False positives named.** `24 Q.`, `4 A. Epstein`, `MOBILE`, `N3`/`N4`/`N10` — concrete examples turned "the aircraft regex is too permissive" into an obvious fix.
- **Distinguishing the interface from the capability.** "MCP timed out but the server persisted the results" is a transport gap, not a broken feature. That distinction shaped the fix.

And the one thing it lacked, which cost the most: **it did not record the build.** Start there.

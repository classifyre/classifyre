# AI Autopilot Evaluation — Enron Second Attempt

Build: Classifyre desktop **v0.4.60** · Namespace `ns_eron_email_no_2` · 2026-07-19
Autopilot was **enabled throughout** (per the task brief — not disabled for attribution, unlike
the first attempt). All claims below are verified against persisted state (`agent_runs`,
`agent_decisions`, `sources`, `inquiries` tables and `/autopilot/*` REST), not against agent
summary strings.

## How autopilot was observed

There are **no MCP tools for autopilot** (first-attempt gap **G-005**, unchanged) — every
observation came via REST `/autopilot/runs` and direct DB reads of `agent_runs` / `agent_decisions`.
`GET /autopilot/status` (from the first-attempt notes) 404s on this build; the runs endpoint works.
This is itself the first finding: **an MCP-only operator — the product's intended integration
surface — cannot see or control autopilot at all.**

## What autopilot actually did (verified)

| Agent | Verified action | Assessment |
|---|---|---|
| **DUPLICATES** | Fingerprinted each scanned runner; APPLIED LINK_DUPLICATE + UPDATE_CLUSTER decisions; rationale strings match `agent_decisions` payloads exactly | **Trustworthy.** Summaries match persisted decisions. No enable/disable toggle (G-028 unchanged). |
| **INQUIRY** | Created 4 inquiries with `createdBy: ai-autopilot`; proposed glossary/memory terms (Tenaska, Kinder Morgan, Bracewell & Patterson, FERC, Transwestern) | **Mixed.** 2/4 inquiries investigation-grade (Regulatory/Legal Entities; Energy Trading Counterparties) — I reused one to seed my case. 2/4 noise ("University", "Seller", "Grand Total"). Memory terms sensible. |
| **CONFIG** | `TUNE_SOURCE` enabled a SECRETS detector on allen-p **and** guzman-m, then `TRIGGER_SCAN` rescanned — unrequested | **Harmful/uncontrolled.** On guzman it **overwrote my just-saved LLM-only config** in a last-writer-wins race (BUG F). No consent surface. |
| **DETECTOR_AUTHOR** | Ran; "0 applied" this cycle | Neutral — no detector authored in scope. |
| **ESCALATION** | Ran; "0 applied; 3 read" | Neutral — read-only. |
| **CASE** | 2 runs **FAILED** "OpenAI model not found (404)"; a later run COMPLETED | **Buggy (BUG E).** Intermittent agent-specific model misconfig. No cases created by autopilot. |

## Provenance and auditability — improved, but incomplete

**Improved since run #1:** inquiries carry `createdBy: ai-autopilot`; every decision is a row in
`agent_decisions` with action/outcome/rationale/payload; the DUPLICATES summary "N applied"
matches the count of APPLIED decisions (run #1's "11 applied / 0 decisions" phantom is gone);
config-change memories are tagged pending-verification. Where I could diff a summary against
persisted state, they agreed.

**Still missing:** none of it is reachable via MCP (G-005). Provenance is auditable only if you
drop to REST or the database. And the **cross-namespace leakage (BUG D)** means this namespace's
`agent_runs` contains a full agent cycle belonging to a *different* namespace (`ns_eron_mail`'s
`source_zipper-a`) — so even the provenance that exists is polluted by foreign runs.

## Cooperation: did agent + autopilot together beat either alone?

**Partly, then it actively interfered.**

- **Positive:** the autopilot's "Regulatory and Legal Entities" inquiry (FERC, Bracewell &
  Patterson) independently surfaced the same regulatory thread I was converging on from RANDOM
  probes. I reused it to seed Case 1 — genuine corroboration, and a real division of labor
  (it proposes standing questions; I verify and build the case).
- **Negative:** the CONFIG agent **silently overwrote my detector configuration** seconds after I
  saved it (BUG F) and hijacked my own manually-triggered run to execute *its* recipe (PII+SECRETS)
  instead of mine (LLM-only). This directly corrupted a controlled experiment and, more importantly,
  means **detector selection is not under reliable operator control while autopilot is on.** It also
  auto-triggered rescans I did not ask for, adding cost and runner noise.

The cooperation model is promising on the read/propose side and dangerous on the write side. The
product gives the operator **no control point** over autonomous config mutation: no consent gate, no
conflict detection, no MCP visibility. On a fresh instance the agents also act by default, so any
controlled work is racing them.

## Did autopilot introduce false positives or harmful changes?

- False positives: 2 of 4 inquiries are generic-word noise; the SECRETS detector it enabled produced
  51 "Public IP" findings (email-header IPs, not credentials) — volume without value.
- Harmful changes: yes — the silent config overwrite (BUG F) and unrequested rescans.

## Recommendations (see improvements.md R-2, R-6, R-12)

1. **P0** — namespace-scope the autopilot scheduler (BUG D).
2. **P0** — optimistic-concurrency + consent gate on agent config writes; never bundle
   config-mutation + auto-rescan silently (BUG F).
3. **P1** — MCP tools mirroring `/autopilot/*` so autopilot is inspectable/controllable from the
   product's own integration surface (G-005).
4. **P1** — fix the CASE agent's model config (BUG E).
5. Inquiry quality: gate autopilot inquiry creation on a value-specificity check so "University"/
   "Seller" don't become standing questions.

## Verdict

Autopilot's **transparency and provenance genuinely improved** over run #1 — its summaries now match
what it actually did. But it remains **invisible and uncontrollable from MCP**, it **leaks across
namespaces**, and its CONFIG agent will **silently overwrite operator configuration and trigger its
own scans**. As a cooperating investigator it contributed one reusable lead; as an autonomous actor
it is not yet safe to leave unattended on work you care about attributing or controlling.

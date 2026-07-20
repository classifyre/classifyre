# Cases and Findings — Enron Corpus, Classifyre Second Validation Attempt

Build: Classifyre desktop **v0.4.60** · Namespace `ns_eron_email_no_2` · 2026-07-19
Scope scanned: RANDOM-100 samples of guzman-m, haedicke-m, allen-p, germany-c, kaminski-v
(5 of 151 mailboxes, ~500 assets). Detector tiers: built-in PII; custom REGEX (FERC dockets);
custom LLM (Email Conduct Screen). Investigation kept independent of the first attempt's two
cases (Forney ERCOT gaming; SPE trail) — those subjects were not targeted.

Every finding cited as evidence below was verified against the original corpus files at
`/Users/andrii.fedorenko/development/tests/enron_mail_git2/mail/` before use.

---

## How the direction was chosen (independence)

I did **not** start from the first attempt's conclusions. I ran RANDOM-sampled PII probes across
five structurally different mailboxes, read what Classifyre actually ingested, and let the
recurring, verifiable signal pick the thread. The cleanest cross-custodian signal that emerged was
**FERC / California-power-crisis regulatory activity**, recurring across three unrelated mailboxes
(allen-p, germany-c, haedicke-m) via exact ORGANIZATION values (FERC, Bracewell & Patterson) — so
that became the case. This is a different thread from run #1.

---

## Case 1 — Enron's regulatory & legal response to the California power crisis (2000–2001)

**Case ID**: `db602e37-0bd1-4304-811a-368b2ed6a350` · Severity MEDIUM · Status IN_PROGRESS
**Investigative question**: how did Enron's regulatory/legal functions organize around the
2000–2001 California electricity crisis, and does the paper trail recur across custodians?
**Linked inquiry**: `f99c63cb` "Regulatory and Legal Entities" (autopilot-authored; 18 matches) —
a case built partly on the autopilot's own inquiry, corroborated independently.

| Evidence (verified at source) | Mailbox | What it is |
|---|---|---|
| "**FERC Activities for California**" filing tracker: PX Credit Waiver (3-13-01), ISO Motion to Obligate Supplier Information (3-16-01), Tucson Electric / Strategic Energy / PNM PX-chargeback complaints (3-19 to 3-22-01), each with an Enron owner (Sanders, Mara, Comnes) | allen-p (`Western Wholesale FERC Issues.doc`) | Enron's regulatory desk actively tracking ≥8 California FERC proceedings in March 2001 |
| "the Federal Energy Regulatory Commission" + "**Bracewell & Patterson**" (Enron outside counsel) recurring | allen-p (`SANDIEGO.DOC`, `Davis.doc`), haedicke-m (`San Diego.doc`) | Legal analysis of the San Diego / Gov. Gray Davis crisis response, same outside counsel across mailboxes |
| FERC references in regulatory-filing summaries `rfs11-17-00.doc`, `rfs3-24-00.doc` | germany-c | Independent third-custodian recurrence of the FERC regulatory-filing thread |

**Verification**: extracted text for `Western Wholesale FERC Issues.doc` was checked verbatim
against the source `.doc` — every distinctive phrase ("Tucson Electric Complaint", "PX Credit
Waiver", "FERC Activities for California", "Strategic Energy Complaint") is present in the raw
binary. Extraction fidelity: **PASS**.

**Chronology event** (verified, attached): 2001-03-13 — Enron regulatory desk tracking ≥8
California FERC filings (confidence 0.9, cites finding `033d8863`).

**Strength / limits**: this is a *genuine, cross-custodian, exactly-recurring regulatory thread* —
the class of signal both first-use runs found most defensible. It substantiates "Enron's legal/
regulatory apparatus was heavily engaged with the California crisis and used common outside counsel
across desks." It is **not**, on this evidence, proof of wrongdoing — it is the regulatory-response
paper trail, which is exactly what the exact-recurrence signal is good for and what LLM-tier conduct
analysis (which failed at scale, see below) would have been needed to push further.

---

## Meaningful findings and false positives judged

| Candidate | Verdict | Why |
|---|---|---|
| FERC / Bracewell & Patterson cross-custodian recurrence | **REAL, investigative** | Exact ORGANIZATION values recurring across 3 unrelated mailboxes; verified at source |
| "FERC Activities for California" filing tracker | **REAL, high value** | Dated, owner-attributed regulatory tracker; verified verbatim |
| guzman-m `UK_NHS` ×3 (all CRITICAL, conf 1.0) | **FALSE POSITIVE** | UK NHS-number recognizer firing on US phone numbers ("877-305-3759") and a timestamp ("2001041403") — one marked FP in-product to test lifecycle |
| PII `ORGANIZATION` "Definitive Agreement", "Grand Total", "Paul DeVries\nCommencing…" | **FALSE POSITIVE / noise** | Generic boilerplate and newline-glued spans mislabeled as organizations |
| SECRETS "Public IP (ipv4)" ×51 (guzman) | **UNREVIEWED / likely low value** | Autopilot-injected SECRETS detector; IPs in email headers, not credentials |
| autopilot inquiries "Educational Institutions" ("University"), "Financial Document Terms" ("Seller", "Grand Total") | **NOISE** | Generic-word matchers; 2 of 4 autopilot inquiries are not investigative |

**Replicated core lesson**: every CRITICAL-severity finding in the run was a recognizer artifact
(UK_NHS on phone numbers), exactly as run #1 found for CREDIT_CARD. **Severity remains a property of
the label, not the evidence.**

---

## The detector that would have mattered — and why it produced nothing at scale

The **Email Conduct Screen** LLM detector is the tool best suited to turn this corpus into cases
(it worked perfectly in isolation: on a synthetic gaming-instruction email it returned
`market_gaming_instruction`, confidence 0.99, with the incriminating passage quoted and the people
named). But at scan scale on a 4-worker pool it produced **zero findings on 100 assets** — every one
of 297 provider calls was rate-limited (503/429) and the errors were silently swallowed to an empty
result while `detector_outcomes` reported OK (BUG A + BUG B, see bugs.md). Throttled to a single
worker it runs without errors [throttle-retry result folded into the protocol ledger]. **The single
most valuable detector is currently unusable at corpus scale on this build**, so the conduct-level
cases the LLM tier could have built were out of reach — the case above rests on the exact-recurrence
signal instead.

---

## Provenance of this investigation's outputs

| Artifact | Origin |
|---|---|
| FERC/California case (`db602e37`) | Operator (fable), built on autopilot inquiry `f99c63cb` |
| Inquiry "Regulatory and Legal Entities" (FERC, Bracewell) | **Autopilot** (`ai-autopilot`) — investigation-grade, reused |
| Inquiry "Energy Trading Counterparties" (Tenaska, Kinder Morgan, Transwestern) | **Autopilot** — investigation-grade, not yet built into a case |
| Inquiries "Educational Institutions", "Financial Document Terms" | **Autopilot** — noise, not used |
| FERC-docket REGEX detector, Email Conduct Screen LLM detector | Operator (fable) |
| SECRETS detector on guzman/allen | **Autopilot** (unrequested config change — see autopilot-evaluation.md) |

---

## What was NOT investigated (honesty section)

- 146 of 151 mailboxes never scanned; each scanned mailbox only RANDOM-100 sampled (and RANDOM is
  seed-0 deterministic, so it is the *same* 100 each run — G-003).
- No ALL-strategy scan was committed, because the LLM conduct tier is non-viable at scale on this
  build (BUG A) and the cheap tier's exact-recurrence value was already demonstrable on the samples.
- The conduct-level question (did any of these regulatory actors cross into market manipulation?)
  could not be pursued — the detector for it silently fails at scale.
- FERC-docket regex produced 0 findings on the sampled slice (dockets absent from the RANDOM-100);
  the recurrence anchor that carried the case was ORGANIZATION values, not docket numbers.

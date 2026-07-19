# Cases and Findings — Enron Email Corpus, Classifyre First-Use #2

Build: Classifyre desktop v0.4.57 · Namespace `ns_eron_mail` · 2026-07-18
Scanned scope: forney-j (full detector tier: REGEX + GLiNER2 + LLM + PII), lay-k / skilling-j / symes-k / delainey-d (cheap tier: REGEX deal-refs + PII). 5 of 151 mailboxes; ~12,000 assets.

Every finding cited below was verified against the original corpus files at
`/Users/andrii.fedorenko/development/tests/enron_mail_git2/mail/` before being attached to a case.

---

## Case 1 — Forney ERCOT desk: scheduling & imbalance-price gaming instructions (2001–2002)

**Case ID**: `18d0b86d-8324-4f04-b051-e1616d9b6c92` · Severity HIGH · Status IN_PROGRESS
**Hypothesis** (`0e2ee2ee`, SUPPORTED, 0.75): Forney's desk coordinated schedules and generator ramping to game ERCOT imbalance prices.

John M. Forney ran Enron's real-time trading desk and later faced prosecution over the
California congestion-gaming playbook (Death Star, Ricochet, Fat Boy). His mailbox — the only
one scanned with the LLM semantic detector — yielded direct desk instructions in his own words:

| Evidence (verified at source) | Where | Date |
|---|---|---|
| "Sell hour ending 6 only – 30 mw's for Frontera tomorrow. **DO NOT GO TO THE POOL**. If … the pool appears to be going to a negative, call Jerry and wake him up. **Have him ramp up** starting he 7." | Drafts, "Frontera Position for tomorrow" | 2002-11-30 (stored date; caveat — post-dates Forney's reported departure; may be export metadata) |
| "I am selling this position for $26.04. **I will be short the Imbalance price** during this time. If you can buy below $26.04 … do so and schedule to load in the South." | index.json (LLM finding `505e93d9`) | 2001–2002 |
| "**tell these guys to trade it up!**" | Sent Items, "POSITION FOR WEEKEND AND MONDAY" | 2001-11-16 |

Individually each item could be aggressive-but-legal trading. The pattern — coordinating
physical generation scheduling with price positions, and explicitly avoiding the balancing
pool while ramping against negative prices — is the conduct class Forney was prosecuted for
in CAISO, observed here on the Texas market. All three were surfaced by the **LLM detector**
(`suspicious-conduct-llm`, deepseek-v4-flash), whose quoted `matchedContent`, `people_involved`
and `rationale` fields made source verification take minutes.

**Chronology events**: 2001-11-16 ("trade it up", DAY, conf 0.9); 2002-11-30 (Frontera draft, DAY, conf 0.6 with caveat).

---

## Case 2 — SPE concealment paper trail: JEDI/Chewco/LJM restatement and litigation hold

**Case ID**: `4a70223c-8bef-485f-81f0-6125a947016b` · Severity HIGH · Status IN_PROGRESS
**Hypothesis** (`88e1989f`, SUPPORTED, 0.85): the SPE web's unwinding is traceable across ordinary employee mailboxes.
**Linked inquiry**: `9d7a19ec` "SPE web" — 28 matches across 5 mailboxes and counting (auto-grew from 25 when delainey-d was scanned).

The off-balance-sheet vehicles at the heart of the fraud left exact-name traces in every
mailbox scanned:

| Mailbox | Hits (verified) | What it actually is |
|---|---|---|
| **lay-k** | ljm ×4, chewco, jedi, whitewing, raptor, osprey, off-balance-sheet ×5 | The **November 2001 8-K restatement announcement**: retroactive consolidation of JEDI/Chewco from 1997 and an LJM1 subsidiary for 1999–2000; hidden debt quantified at $711M (1997), $561M (1998), $685M (1999), $628M (2000) |
| **forney-j** | LLM `document_destruction` (conf 0.9) | 2001-10-26 "**Important Announcement Regarding Document Preservation**" — company-wide litigation hold over LJM shareholder suits, warning of individual civil/criminal liability. Found in Forney's **Deleted Items**. |
| **skilling-j** | ljm ×6, jedi, raptor, osprey ×6, off-balance-sheet | LJM2/JEDI references incl. SEC-filing attachments (`getdocs[N].htm`) |
| **delainey-d** | ljm, jedi, raptor, off-balance-sheet ×2 | Deal-structuring email: "different structures involving (i) **LJM**; (ii) AIG; or (iii) selling to Calpine…" tied to **earnings recognition** — live use of LJM as a structuring counterparty, not news coverage |
| **symes-k** | raptor | (weaker; not attached) |
| cross-mailbox | Osprey in 6+ copies of the same `012301ene.pdf` attachment across sources | The same Osprey notes document circulated to multiple custodians — exact cross-document recurrence |

**Chronology events**: 2001-10-26 litigation hold (DAY, conf 0.95); 2001-11 restatement (MONTH, conf 0.9).

---

## Findings judged and rejected (the negative results that matter)

| Candidate | Verdict | Why |
|---|---|---|
| symes-k `death_star` | **FALSE POSITIVE** | Enron IT server "E10K deathstar" — server fleet named yoda / skywalker / Chewbacca |
| skilling-j `fat_boy` | **FALSE POSITIVE** | Harley-Davidson Fat Boy motorcycle prize |
| skilling-j + lay-k `ricochet` | **FALSE POSITIVE** ×2 | Metricom "Ricochet" wireless ISP |
| lay-k `CREDIT_CARD` ×7 (all CRITICAL) | **FALSE POSITIVE** ×7 | Suite number + phone concatenations ("1130 713-622-5360") at recognizer confidence 1.0 |
| skilling-j `shredding` | **FALSE POSITIVE** | McKinsey manuscript email: "have the copy properly shredded" (2001-07-17) — an unintentionally poignant footnote, but not evidence |
| LLM `none` ×47 | noise by my own design | Including a `none` label produced 47 no-op findings; excluded from all analysis |

**Every California-scheme-name regex hit outside forney-j was a false positive**, and **every
CRITICAL-severity finding in the entire run was a recognizer artifact** — replicating the first
first-use run's core lesson on an unrelated corpus: severity is a property of the label, not
of the evidence.

## Precision summary by detector (scanned slice)

- **LLM (`suspicious-conduct-llm`)**, forney-j only (run manually stopped at ~page 370/468): final tally 23 non-`none` findings (market_manipulation 17, legal_risk_discussion 4, document_destruction 2) + 64 `none` noise; the 5 reviewed in depth were all genuine and evidence-quotable — the remaining 18 are unreviewed candidates for a follow-up session. Best signal-per-finding of any detector. Cost: ~6 s/page — usable on one small mailbox, unaffordable corpus-wide.
- **REGEX deal-refs**: SPE codenames (LJM, Chewco, JEDI, Whitewing, Raptor, Osprey) — high precision, genuinely investigative. Scheme names (Death Star, Fat Boy, Ricochet, Get Shorty) — 0/4 precision; retired mentally, kept in product as marked FPs.
- **GLiNER2 entities**: 1,600 accurate extractions (spans verified) but investigation value limited at file granularity — the entity list of a whole mailbox is a phonebook.
- **PII (restricted set)**: PHONE_NUMBER plentiful and accurate (useful only for recurrence); CREDIT_CARD 0/7.

## What was NOT investigated (honesty section)

- 146 of 151 mailboxes never scanned (performance wall — see bugs B-4/OBS-5).
- Semantic search could not be exercised at all (B-5 — embedding stack dead on this build); all discovery above came from detectors + inquiries + manual source verification.
- kean-s / dasovich-j / kaminski-v (the largest, historically richest mailboxes) were out of reach at ~46k index pages each on this build.
- The 2002-11-30 draft date anomaly was recorded but not resolved.

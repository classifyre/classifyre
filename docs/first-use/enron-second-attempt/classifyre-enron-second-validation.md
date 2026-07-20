# Re-testing Classifyre on Enron: what got fixed, what still bites

*A second field report. Same corpus, new build, autopilot left on, and a deliberate effort not to
re-run the first investigation.*

Six months ago we pointed a fresh Classifyre desktop instance at the Enron email archive and came
away with a blunt verdict: *"an extraction engine with an investigation shell around it."* It found
real evidence, but its flagship semantic layer was silently dead, its counters lied on the first
run, and its best detector was the one the product couldn't even test.

The team shipped fixes. This is the re-test — build v0.4.60 — and the honest headline is: **most of
the plumbing is genuinely fixed, and the product now clears the bar the first run set. But the one
capability that would turn this corpus into real cases still breaks at scale, and this time the
autopilot fought me for control of my own configuration.**

## Keeping it independent

The first report is a confirmation-bias trap: if you go looking for Forney's trading desk and the
SPE trail, you'll find them and learn nothing about the product. So I started cold — RANDOM-sampled
PII probes across five structurally different mailboxes (a trader, the legal department, an
attachments-only classic, a regulatory desk, a research shop) — and let whatever recurred, verifiably,
across custodians pick the thread. What surfaced was **not** the first run's cases. It was Enron's
regulatory-and-legal response to the 2000–2001 California power crisis.

## The corpus changed too

The auxiliary JSON mailbox indexes from the first run were removed. That turned out to matter more
than expected — and mostly for the better. In the first attempt, a whole mailbox was ingested as one
giant JSON asset, so a finding couldn't point you to the email it came from. Now that the indexes are
gone, Classifyre ingests **one file per asset**: every `.eml` and every attachment is its own object.
The single deepest product-fit complaint from the first run — "findings can't point to their email" —
is simply gone, because the unit of ingestion is now the email. (Caveat: this is partly the corpus's
doing, not only the product's. And a lot of what's left on disk is git-LFS pointer stubs and
placeholder files masquerading as attachments — you have to read coverage numbers against that.)

## What's fixed — verified, not taken on faith

- **Semantic search is alive.** Last time, 115,000 chunks were stored and *zero* embedded while the
  health endpoint reported all-green. This time `/embeddings/status` shows a registered worker, a
  real embedding model (MiniLM-384d), and rows populating as scans run — confirmed by watching the
  database. Vector search returned the right trading spreadsheets for a query whose words weren't in
  their filenames. It's doing embeddings, not secret keyword matching.
- **First-run counters are honest.** A 100-asset first scan reports `assetsCreated: 100`, not `0`.
- **Run honesty works in the field.** One scan ended `WARNING` with a coverage histogram and an error
  naming the cause — which turned out to be a single genuinely corrupt spreadsheet LibreOffice
  couldn't open. It surfaced the failure without failing the whole run.
- **Triage survives rescans.** I marked a false positive, then rescanned with a completely different
  detector set. The FP mark, its finding ID, and every *other* detector's findings all survived. For
  anyone who's lost triage work to a re-run, that durability is the difference between a tool and a
  toy.

That's four of the first run's headline problems, closed and checked.

## The case the tool helped build

The cleanest signal in both field tests is the same: **an exact value recurring across unrelated
documents.** Here it was the regulator and the law firm. "FERC" and "Bracewell & Patterson" (Enron's
outside counsel) recurred across three unrelated mailboxes — allen-p, germany-c, haedicke-m. Pulling
the thread surfaced a March 2001 document titled *"FERC Activities for California"*: a filing tracker
listing eight-plus California proceedings — PX Credit Waiver, an ISO motion to obligate supplier
information, chargeback complaints from Tucson Electric and others — each dated and assigned to a named
Enron owner. I verified it the only way that counts: every distinctive phrase the product extracted is
present, verbatim, in the original `.doc`.

Nicely, the autopilot had independently created a standing inquiry for exactly these regulatory
entities. I reused it to seed the case. That's the cooperation model working: the agent proposes a
standing question, the investigator verifies and builds on it.

## What still fails — and it's the important part

**The detector that would turn this corpus into *conduct* cases silently produces nothing at scale.**
I built an LLM "conduct screen" — flag market-gaming instructions, financial-distress admissions,
legal-risk discussions — and in isolation it was excellent: on a test email it returned the right
label at 0.99 confidence with the incriminating sentence quoted. Then I ran it across 100 real emails
and got **zero findings**. Not because the emails were clean — because *every single* provider call
was rate-limited (503/429), and the detector catches those errors and returns an empty result. The
run reported `COMPLETED`, the per-detector outcome reported `OK`, and the finding count was zero —
indistinguishable from "we checked and found nothing." Throttling to a single worker helped but didn't
fix it (the detector is also, separately, being run *twice* per email). This is the same silent-failure
class the first run flagged for a different detector: **a green run is not proof that anything was
checked.**

And this time the autopilot actively got in the way. I saved a detector configuration; thirteen
seconds later the CONFIG agent overwrote it with its own choice — using a stale copy of the config
from before my edit — and then triggered its own rescan. My own manually-started run executed the
agent's configuration instead of mine. The autopilot's transparency is genuinely better now (its
summaries match what it actually did, which wasn't true last time), but it will silently overwrite
your work and it's completely invisible from the product's own integration surface. On a fresh
instance it acts by default, so any controlled work is racing it.

## Tips for a large-mailbox investigation on this build

1. **Lead with exact-recurrence.** Organization names, docket numbers, counsel — the same value across
   custodians is the most defensible signal the product produces. Standing inquiries over those grow
   automatically as you scan.
2. **Treat severity as decoration.** Every CRITICAL in this run was a UK-NHS-number recognizer firing
   on US phone numbers. Rank your attention by what you can verify, not by the label's color.
3. **Read the WARNING and the coverage histogram before you trust a finding count** — they're honest
   now and they'll tell you what actually got scanned.
4. **Don't rely on an LLM detector across a whole corpus yet.** It works in a test and on a handful of
   documents; at scale it silently rate-limits itself into producing nothing. Verify it produced
   findings, don't assume.
5. **If you care about attribution or control, watch the autopilot** — it will change your config and
   start scans on its own, and you can only see that over REST or in the database.
6. **Keep the original corpus mounted.** The grep-against-source loop is still where verification
   actually happens.

## Verdict

The first field test said the product was an extraction engine with a shell around it. **The shell
works now** — semantic search, honest runs, durable triage, email-level evidence. That's real
progress, verified against the database and the source files, not taken on trust. But the analytic
tier that separates "here is a pile of text" from "here is what matters" — the LLM conduct screen — is
exactly the piece that silently fails at scale, and the autopilot is not yet safe to leave alone with
work you care about. The judgment is still yours. The difference from last time is that the tool now
does its half of the job honestly — right up until you ask the hardest question, which is still the
one it can't answer at scale.

*All findings described were verified against the original Enron corpus files. Bugs mentioned are
documented with reproductions in the accompanying reports.*

# Grepping Enron with a Case File: Investigating 151 Mailboxes with Classifyre

*A field report from a one-day smoke test — real corpus, real findings, real bugs.*

The Enron email archive is the investigator's classic: 151 employee mailboxes, 377,000
files, 14 GB of messages and attachments, and a known ground truth — we know how the story
ends, which makes it the perfect test bench for investigation software. I pointed a fresh
Classifyre desktop instance (v0.4.57) at it and spent a day finding out what the product
could actually prove.

By the end of the day I had two evidence-backed cases: the real-time trading desk of John
Forney — the man who named the "Death Star" scheme — instructing his traders in writing to
avoid the balancing pool and wake up a generator operator to "ramp up" against negative
prices; and the paper trail of the JEDI/Chewco/LJM special-purpose-entity web unwinding
across five mailboxes, from the November 2001 restatement announcement in Ken Lay's inbox
to the litigation-hold notice sitting, of all places, in Forney's Deleted Items.

Here is how the investigation actually went — including the parts where the product got in
the way.

## Start smaller than you think

The corpus profile came first, before touching a single scan: file counts, sizes, and a
sample of what the documents actually were. That five-minute step made every later decision.
It told me the archive was pre-parsed JSON (one big index per mailbox plus extracted
attachments), that attachments ranged from Word docs to TIFF scans, and — critically — that
mailboxes ranged from 26 files to 74,000. I picked the smallest historically-interesting
mailbox for the first deep scan: forney-j, 161 files. Not Skilling, not Lay. The guy who
ran the desk.

That choice paid for itself within the hour. My "deep tier" — an entity extractor, a
regex detector for Enron deal codenames, built-in PII, and an LLM classifier for suspicious
conduct — took **hours** on that one small mailbox. The pipeline pages large files into
100-line chunks and runs every detector on every page; the LLM and entity models cost ~6
seconds per page warm, 34 cold. Had I started with Skilling's 800,000-line index, I would
have learned nothing all day. Instead I learned the cost structure early and split my
detectors into tiers: the LLM depth probe stayed on Forney; everyone else got the cheap,
fast detectors (regex + PII at ~0.5 s/page).

**Lesson 1: measure detector cost on the smallest interesting slice before committing the
corpus.**

## The LLM detector earned its keep; the regex taught me humility

The best findings of the day all came from the LLM detector — a classifier prompted to flag
document destruction, market manipulation, accounting concealment, and insider stock
activity, with a quoted passage, the people involved, and a one-line rationale on every hit.
That quoting matters more than it sounds: when the detector says *"DO NOT GO TO THE POOL…
call Jerry and wake him up. Have him ramp up"*, you can verify it against the raw corpus in
one grep. Five out of five hits I reviewed in depth were genuine. One design mistake was
mine: I gave the classifier a `none` label for routine email, and it dutifully produced 64
`none` findings — pure noise. Let the confidence threshold do that job.

The regex detector told a two-sided story. The SPE codenames — LJM, Chewco, JEDI,
Whitewing, Raptor, Osprey — were exact, high-precision, and did exactly what exact-match
detectors do best: reveal the same names recurring across unrelated mailboxes. A standing
inquiry over those finding types grew automatically from 25 to 28 matches the moment a new
mailbox finished scanning. That's the recurrence workhorse of the whole investigation.

The California scheme names, though? **Zero for four.** "Death Star" turned out to be an
Enron IT server (in a fleet named yoda, skywalker, and Chewbacca — someone in IT had a
sense of humor). "Fat Boy" was a Harley-Davidson raffle prize. "Ricochet," twice, was a
defunct wireless ISP. And every single CRITICAL-severity finding in the run — seven
"credit cards" — was a suite number glued to a phone number. If you take one thing from
this post: **a detector label is a lead, not a fact, and severity is a property of the
label, not the evidence.**

## Verification is the actual work

Every finding that made it into a case was checked against the original files first. This
was non-negotiable and, honestly, where the investigation actually happened. It's also
where the product is weakest today: findings on big paginated files don't carry a pointer
to the email they live in, so verification means grepping the source corpus. The product
surfaced the leads and kept the case file; the judgment loop ran through my terminal.

The case tooling itself was a pleasant surprise: hypotheses with weighted supporting
evidence, dated chronology events that require citing the findings they came from, inquiry
auto-tracking. When I marked the Death Star server and the Harley as false positives with
explanatory comments, those judgments **survived a full rescan with a changed detector
set** — finding IDs intact. For anyone who has lost triage work to a re-run, that
durability is the difference between a tool and a toy.

## The autopilot did something I didn't expect

Halfway through, I noticed an unrequested scan running. The instance's autonomous agents,
on by default, had watched my lay-k scan finish, independently diagnosed the same
credit-card false-positive pattern I'd found, disabled that recognizer on the source,
authored a new detector for the generic term "special purpose entity," and kicked off a
verification rescan — tagging its own conclusions "pending-verification." The rescan then
*disproved* its hypothesis (the term never appears in that mailbox), which is exactly what
a verification run is for. Competent, auditable — and slightly unnerving: it silently
edited a source configuration I had written minutes earlier. I disabled the agents for
attribution's sake and audited their work afterward. It held up.

## What didn't work

An honest field report has to include this list:

- **Semantic search was silently dead.** The desktop build shipped without its embedding
  model's dependency; 115,887 text chunks were stored and zero were embedded, while the
  health endpoint reported all green and "semantic" queries quietly fell back to keyword
  matching. I only caught it by querying the database directly.
- **OCR failed on every scanned image** on Apple Silicon (a float64/MPS incompatibility) —
  hundreds of TIFF attachments contributed no text.
- **First-run counters are wrong** (`assetsCreated: 0` for 2,239 newly created assets),
  a regression of a previously fixed bug.
- **A whole mailbox is one asset.** Findings can't point to their email, and the case
  graph's "evidence neighborhood" of a mailbox-sized asset is everyone in the phonebook.
  Email-aware granularity is the single change that would most improve the product.

## Tips for your own large-mailbox investigation

1. Profile the corpus on disk before configuring anything.
2. Deep-scan the smallest interesting custodian first; measure cost, then tier.
3. Prefer exact identifiers (deal names, docket numbers) for standing inquiries; expect
   commercial-name collisions and verify every hit.
4. Give LLM detectors labels for what you want, not an escape label — and make them quote
   their evidence.
5. Treat severity as decoration. Rank your attention by verifiability.
6. Keep the original corpus mounted next to the tool. The grep loop *is* the investigation.
7. Mark false positives in the product with the reason — future you, and apparently the
   autopilot, will read them.

The verdict from the previous field test of this product was "an extraction engine with an
investigation shell around it." This time the shell worked, the honest-run reporting
worked, and the LLM detector found emails a human investigator would genuinely want on
their desk — with named, dated, quotable evidence. The judgment is still yours. For now,
that's the right division of labor.

*All findings described were verified against the original Enron corpus files. Bugs
mentioned are documented with reproductions in the accompanying test report.*

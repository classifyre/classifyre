# SL2 · Bindings and vocabulary: saying what detector outputs mean

*Part of [the semantic layer](SL0-semantic-layer-architecture.md). Research: [glossary-semantic-layer.md](../research/glossary-semantic-layer.md) §6.3.*

| | |
|---|---|
| **Status** | Draft for review |
| **Date** | 2026-10-01 |
| **Size** | M |
| **Milestone** | M2, built together with SL3 |
| **Depends on** | SL1 |
| **Feeds** | SL3 (applies bindings), SL4 (suggests bindings), SL5 (unbound lane), G7 (coverage) |
| **Owns** | Foundation F8 (vocabulary inventory); contract C9 (binding spec); the bindings part of C10 (packs); the binding compiler |

## 0. Decisions that apply

| # | Decision |
|---|---|
| D3 | Bindings are the primary way to link. They are built **from the observed vocabulary, not from regex**, and there is no separate GLOSSARY detector |
| D7 | Agents may approve their own bindings in MANAGED mode, with a preview, decision log, undo and budgets |
| D8 | Starter packs ship bindings to built-in detectors |
| D10 | "Find in text" generates an ordinary REGEX detector bound to the term |
| SL-7 | A binding never contains a regex |

## 1. Problem

Every detector speaks its own vocabulary:

| Detector | What it writes in `findingType` |
|---|---|
| PII | `IBAN_CODE` |
| SECRETS | `AWS Access Key` (detect-secrets type names) |
| GLiNER2 | `entity:organization` |
| TAG | `tag:legal_form`, value `GES` |
| LLM | `force_majeure` |
| Classifier | `classification:risk:high` |
| CUSTOM metadata | `doc_type: "contract"` |

None of it says what it means. The meaning lives in an analyst's head, or in an agent's prompt. A TAG rule that encodes meaning has to be copied into every source, and changing it means a re-scan (gap analysis §4.2).

A binding states the meaning **once**. It applies to every past and future finding, needs **no re-scan**, and every link it produces says which binding it came from.

The product owner asked that this be "well thought and well implemented in the UI": is it a regex on the value, or can any finding type be mapped without a value? The answer in this PRD:
- A binding is a choice from what the data **actually contains**: a detector output, optionally narrowed to some of its observed values, or read as codes.
- It is never a pattern; patterns belong in detectors.

## 2. Goals and non-goals

### Goals

1. An inventory of the observed vocabulary: detector outputs per source, and asset metadata fields, with counts, distinct values and top values (F8).
2. Five binding modes that cover outputs, values, code look-ups and metadata, in plain language.
3. One dialog, reachable from a finding, an asset, a detector, a term and the *Unbound vocabulary* list. It has smart defaults and a live preview.
4. A binding compiler with an SQL half and an in-memory half that provably agree. The SL3 linker and every preview use it.
5. *Unbound vocabulary*: the worklist of outputs that have open findings but no meaning, ordered by volume, with semantic coverage.
6. "Find in text": a term becomes a tested, bound REGEX detector in one action (D10).
7. Starter packs that bind built-in detectors, and pack install, upgrade and uninstall (D8).
8. Agents propose bindings and approve their own within guardrails (D7).

### Non-goals

- Applying bindings to produce links, and the surfaces that show links (SL3).
- Machine-generated binding suggestions (SL4); this PRD defines the DRAFT state they land in.
- Pattern or regex bindings (SL-7). Bindings on finding fields from G4 (later; D4).

## 3. Words

| Word | Meaning |
|---|---|
| **Output** | What a detector writes, identified by `(detectorType, customDetectorKey, findingType)`. `customDetectorKey` is empty for built-ins |
| **Field** | A top-level or one-level-nested key in asset `metadata`, per source (`doc_type`, `address.postcode`) |
| **Value** | A finding's `matchedContent`, or a field's value, after normalisation (§4.4) |
| **Categorical output** | An output with few distinct values (≤ 50 in the inventory), or one from a TAG, LLM-label or classification runner |
| **Open-valued output** | Everything else: e-mail addresses, IBANs, names |

## 4. The binding

### 4.1 Five modes

| Mode | Label in the UI | Means | Example |
|---|---|---|---|
| `OUTPUT` | **Every finding of this kind** | All findings of the output → one concept | PII `IBAN_CODE` → *Bank account* |
| `OUTPUT_VALUES` | **Only these values** | Findings of the output whose value is one of the chosen values → one concept | `tag:insolvency_status` ∈ {*insolvent*, *in Liquidation*} → *Insolvency* |
| `OUTPUT_LOOKUP` | **Each value names a term** | Each finding's value is looked up among the codes or labels of APPROVED concepts in one scheme → that concept | `tag:legal_form` → scheme *Rechtsformen* (`GES` → *GmbH*, `AG` → *Aktiengesellschaft*) |
| `METADATA_VALUES` | **Assets where a field has these values** | Assets whose field equals one of the values → one concept (asset level) | `doc_type` = *contract* → *Contract* |
| `METADATA_LOOKUP` | **The field's value names a term** | Each asset's field value is looked up in one scheme → that concept | `pks_code` → scheme *PKS* |

All modes can be narrowed to **some sources**; the default is all sources. This handles one output meaning different things in different places: `entity:organization` in a supplier mailbox is *Supplier*, while in the HR share it is *Employer*.

An output may have several bindings, for example to two concepts in different schemes. The dialog warns "already means *X* — add another meaning?" Bind to the **narrowest** concept: broader concepts follow from the taxonomy (SL3 rolls up), so binding *IBAN* to both *Bank account* and *Financial data* is redundant, and the dialog says so.

### 4.2 Why there is no regex

A binding maps vocabulary to meaning; it doesn't detect anything. A meaning that depends on a pattern ("IBANs starting with `AT`") is a detection problem: tune a REGEX detector, or use "Find in text" (§7), then bind that detector's output.

This keeps:
- one rule language in the product (integration architecture §1);
- bindings indexable, through typed columns rather than JSONB predicates (integration rule 11);
- every link explainable in one sentence.

### 4.3 Lookup modes

**Matching:**
- `lookupMatch = CODES`: the value equals a concept's code, exactly and case-sensitively, after trimming. Use it for register and statistical codes.
- `lookupMatch = ANY`: the normalised value is in the concept's `matchKeys` (term, aliases, codes and hidden aliases). Hidden aliases count here, so `E` resolves to *Einzelvertretung*: lookup is not text matching (SL1 R3).

**Values with no concept:**
- They link nothing.
- They appear in the binding's *Unmatched values* list, with counts and a *Create concept* action.

**Ambiguous values** (one value, two concepts in the scheme): no link is made, and the value appears as *ambiguous* with both candidates.

### 4.4 Value normalisation

- Values are compared after Unicode NFKC normalisation, trimming, collapsing internal whitespace and case-folding. This is the same function on both halves of the compiler: `glossaryNorm()` in TypeScript, and `glossary_norm(text)` in SQL, an immutable function created per tenant schema by the migration.
- `splitDelimiter` (optional, default none) splits a value before comparing. This is for multi-valued tags: the notebook SDK joins repeated values for one key with `", "`. The dialog proposes `,` when a sample of the output's values contains it.
- `OUTPUT_VALUES` and `METADATA_VALUES` store their values already normalised. The UI shows the most frequent original spelling.

### 4.5 Status and lifecycle

```
DRAFT ──approve──▶ APPROVED ──disable──▶ DISABLED ──enable──▶ APPROVED
```

| Rule | Detail |
|---|---|
| Who can approve | Operators: any binding. Agents: their own bindings, under D7 (§9) |
| Approved creation | An operator saving the dialog creates an APPROVED binding |
| Packs | Install their bindings APPROVED, unless the detector they reference is missing, in which case they wait as DRAFT (*waiting for detector*) |
| What drives links | Only APPROVED bindings whose target concept is APPROVED (SL-5). Disabling a binding stops new links; SL3 marks its links GONE |
| Deleting | Allowed for DRAFT and DISABLED bindings. APPROVED bindings must be disabled first, so history is never silently rewritten |
| Concept deprecated | Bindings that point at it stay, flagged *target deprecated*. When the concept has `replacedBy`, the flag offers *Retarget* |

### 4.6 The binding compiler

`apps/api/src/semantic/bindings/binding-compiler.ts` is the single home of binding semantics:
- `compileFindingPredicate(binding)` returns a `Prisma.Sql` fragment over `findings f` (and `glossary_terms t` for lookups), including `f.status = 'OPEN'` and the source scope.
- `compileAssetPredicate(binding)` does the same over `assets a`, for the metadata modes.
- `matchesFinding(binding, finding, termsIndex)` and `matchesAsset(...)` are the in-memory halves, used for single-finding Meaning cards (SL3) and previews.
- `binding-compiler.conformance.spec.ts` runs a fixed fixture of findings and assets through both halves, for every mode, with source scopes, split values, Unicode edge cases and ambiguous lookups. It must agree row for row. This follows `matcher-sql-conformance.spec.ts`.

## 5. The vocabulary inventory (F8)

### 5.1 What it holds

| Table | Grain | Columns |
|---|---|---|
| `vocabulary_items` | source × output | `openCount`, `assetCount`, `distinctValues` (capped at 1,001, meaning "more than 1,000"; `null` when not computed), `topValues` (up to 25 `{value, count}`), `firstSeenAt`, `lastSeenAt`, `refreshedAt` |
| `vocabulary_fields` | source × metadata path | `assetCount`, `distinctValues`, `topValues`, `refreshedAt` |

### 5.2 How it is refreshed

**When.** A `vocabulary-refresh` pg-boss queue, registered per namespace (integration rule 8). It coalesces per source and is scheduled:
- when a run finalises;
- after a bulk finding status operation;
- on demand (*Refresh* on the *Unbound vocabulary* tab).

**Outputs:** one grouped query over the source's OPEN findings. Value statistics are computed only for outputs that are:
- categorical by runner (TAG, LLM label, classification), or
- smaller than 50,000 open findings.

Everything else gets `distinctValues = null` and is treated as open-valued. Every statement has a timeout, and a refresh never blocks the run.

**Fields:**
- `jsonb_object_keys` over the source's assets, at the top level plus one nested level.
- Keys starting with `_`, and those the platform writes itself (`content_reference`), are skipped.
- Value statistics as for outputs.

**Never live.** Pages read only these tables.

### 5.3 Human labels

The UI never shows a raw output tuple alone. `vocabularyLabel(output)` renders:

| Output | Label |
|---|---|
| PII `IBAN_CODE` | **IBAN code** · PII |
| SECRETS `AWS Access Key` | **AWS Access Key** · Secrets |
| CUSTOM `force_majeure` (LLM detector *Supplier mail*) | **force_majeure** · Supplier mail |
| CUSTOM `entity:organization` (GLiNER2 *Parties*) | **organization** · Parties |
| CUSTOM `tag:legal_form` (TAG *legal_form*) | **legal_form** · tag |
| CUSTOM `classification:risk:high` | **risk = high** · *detector name* |

The raw tuple is shown on hover and in exports.

## 6. User experience

### 6.1 The dialog

One dialog, *What does this mean?*, opened from five places (§6.2). It is a single panel, with the preview always visible.

```
┌ What does this mean? ─────────────────────────────────────────────────────────────────────┐
│ 1  What the data says                                                                     │
│    legal_form · tag            in  ◉ all sources   ○ only: [ Firmenbuch ▾ ]               │
│    1,140 open findings · 1,140 assets · 9 distinct values                                 │
│                                                                                           │
│ 2  Which findings                                                                         │
│    ○ Every finding of this kind                                                           │
│    ○ Only these values        [✓ GES 980] [  AG 22] [  KG 61] [  OG 41] …                 │
│    ◉ Each value names a term  scheme [ Rechtsformen ▾ ]   match ◉ codes ○ codes and labels │
│                                                                                           │
│ 3  What it means                                                                          │
│    (lookup: per value, see preview)          — or — concept [ Search concepts… ] [+ New]  │
├ Preview ──────────────────────────────────────────────────────────────────────────────────┤
│  GES → ⬡ GmbH (980)   AG → ⬡ Aktiengesellschaft (22)   KG → ⬡ Kommanditgesellschaft (61)  │
│  OG → ⬡ Offene Gesellschaft (41)                                                          │
│  Unmatched: EU (12) [Create concept]  · Ambiguous: — · Will link 1,128 assets in 1 source │
│  Samples: FN 606601k · FN 12345a · …                                                      │
│                                                           [ Cancel ]  [ Save binding ]    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**Smart defaults.** The dialog opens on the most likely mode:

| The output is… | Default mode |
|---|---|
| Open-valued | **Every finding of this kind** |
| Classification (the label is already in the type) | **Every finding of this kind** |
| Categorical, and ≥ 50% of its top values (by count) match codes or labels of APPROVED concepts in one scheme | **Each value names a term**, with that scheme preselected |
| Categorical otherwise | **Only these values**, with the value that opened the dialog already ticked |
| A metadata field | The same rules, using the field's values |

**Value pickers** list the observed top values with counts, never a free-text box. *Type a value…* is available under *More* for values not yet observed; it is normalised the same way.

**The concept picker:**
- searches APPROVED concepts by lookup (SL1 R7) and shows each one's scheme and broader path;
- *+ New* creates a concept inline (term, scheme, definition): APPROVED for operators, DRAFT for agents.

**The preview** comes from `POST /semantic/bindings/preview`, which runs the compiler's SQL half with a statement timeout of 5 s and returns:
- counts: open findings, assets, sources;
- up to 5 samples, with matched content through the content presenter (F6);
- for lookups: the value → concept table, unmatched values and ambiguous values;
- warnings: already bound, redundant with a broader binding, a missing detector, more than 10,000 findings.

**Save** creates the binding and schedules SL3's backfill. A toast links to the progress: "Linking 1,128 assets… View".

### 6.2 Where the dialog opens

| From | How | Prefilled |
|---|---|---|
| **Finding page** | Meaning card (SL3) → *What does this mean?* | The output, plus this finding's value |
| **Findings table** | Row menu, and bulk *Bind outputs…* for a selection of outputs | The output(s) |
| **Detector page** | New *Meaning* tab: one row per output of this detector across sources, with counts, current bindings, *Bind…*, and suggestions (SL4) | The output |
| **Term page** | *Bindings* tab → *Add binding* → output picker (search outputs by label or detector, with counts) → dialog | The concept |
| **Asset page** | Metadata card → field menu → *What does this field mean?* | The field |
| **Glossary → *Unbound vocabulary*** | Row action | The output or field |

### 6.3 *Unbound vocabulary* (the data-dictionary worklist)

A new Glossary tab. Each row is an output or field that has open findings (or assets) and no APPROVED binding.

| Column | Content |
|---|---|
| Vocabulary | Human label, plus a detector or source chip |
| Sources | Count, with names on hover |
| Open findings | Number |
| Values | Distinct-value count, or "open-valued" |
| Suggestion | From SL4 when available: concept, mode, score |
| Actions | *Bind…*, *Accept suggestion*, *No meaning* |

**No meaning** marks the item as deliberately unbound, for example `DATE_TIME`. The mark is stored as an APPROVED binding of mode `OUTPUT` with `termId = null` and `noMeaning = true`, so it is versioned and can be undone like any binding. It removes the item from the list and counts as covered.

**Sort** is by open findings, descending. **Filters:** source, detector, has suggestion, fields or outputs.

**Header:** "Semantic coverage: **73%** of open findings carry a meaning · 21 outputs unbound (3,402 findings)". Coverage is computed by SL3; G7 picks it up.

### 6.4 The detector page's Meaning tab

```
Output                    Sources  Open     Means                                      
IBAN code · PII           3        812      ⬡ Bank account (Every finding)          [⋯]
E-mail address · PII      5        12,403   ⬡ E-mail address (Every finding)        [⋯]
DATE_TIME · PII           5        48,210   — no meaning —                           [⋯]
NRP · PII                 2        310      Unbound  · suggestion: ⬡ Political…  [Bind…]
```

## 7. "Find in text" (D10)

For concepts and entities that appear only as words: a PDF that says *Eigenmittelquote* and has no detector output to bind.

**Action.** On the term page, *Find in text…* opens a dialog:
- **Labels to match:** the term and aliases, matched case-insensitively, plus the codes, matched case-sensitively. Each label has a checkbox. Hidden aliases are excluded and labels shorter than 3 characters are unchecked; both say why.
- **Options:** whole words (on); also match word continuations such as *Eigenmittelquote**n*** (off); severity (default info).
- **Attach to sources:** a multi-select of sources, optional.
- **Preview:** the generated pattern, and the tests it will run.

**It creates:**
1. A **REGEX custom detector** with key `glossary-<term-key>`, named "Find: <term>", and one pattern named `<term-key>` with `group: 1`. That pattern is a single alternation, with every literal escaped (`EQR` stands in for a code):
   ```
   (?:^|[^0-9A-Za-zÀ-ɏ])((?i:eigenmittelquote|equity ratio|capital ratio)|EQR)(?:[^0-9A-Za-zÀ-ɏ]|$)
   ```
   - The `(?i:…)` group holds the case-insensitive labels. Codes outside it stay case-sensitive.
   - **Word boundaries are explicit, not `\b`.** The REGEX runner uses google-re2 when installed and falls back to Python's `re` (`runners/_regex.py`):
     - in RE2, `\b` and `\w` are ASCII-only, so a label such as *Überschuldung* would never match;
     - Python's `re` treats `\w` as Unicode.

     The explicit class covers ASCII and the Latin-1 and Latin Extended letters, and behaves the same in both engines. Capture group 1 keeps the boundary characters out of the finding's value.
   - With continuations enabled, `[0-9A-Za-zÀ-ɏ]*` is appended inside the case-insensitive group only.
   - Known limit: non-Latin scripts (Greek, Cyrillic) get no boundary protection in v1. The dialog warns when a label contains such characters.
2. **Test scenarios:**
   - one positive per checked label (*"…the <label> was…"*);
   - a positive with the label at the start of the text, and one with it directly after punctuation;
   - one positive for any label that starts or ends with a non-ASCII letter (*Überschuldung*), which pins the boundary rule in both engines;
   - one negative per code, embedded inside a longer token (`XEQRX`);
   - one negative per excluded hidden alias.

   They must pass before the detector is attached (the custom-detector test machinery).
3. An APPROVED **binding** `OUTPUT (CUSTOM, glossary-<term-key>, regex:<term-key>) → term`.
4. If sources were chosen, the detector is added to their detector lists. Their next run scans only this detector on cached assets, because the scan cache keys on the detector's fingerprint (`pipeline/scan_cache.py`).

**Keeping it in step.** The custom detector gets a nullable `generatedFromTermId` and a `generatedLabelsHash`.
- When the term's labels change, the detector shows *Out of date — regenerate*. Regenerating bumps the detector version, so the scan cache re-runs it.
- Deprecating the term flags the detector.
- Deleting the term leaves the detector in place, marked *orphaned*.
- A generated detector can be edited like any other REGEX detector; once edited by hand it stops offering *regenerate*.

## 8. Packs (D8)

### 8.1 Format (C10)

`classifyre.glossary-pack/v1`, as JSON; the schema lives in `packages/schemas/src/schemas/glossary_pack.json`.

```json
{
  "format": "classifyre.glossary-pack/v1",
  "key": "gdpr-personal-data",
  "version": "1.0.0",
  "name": "GDPR personal data",
  "language": "en",
  "sources": ["https://eur-lex.europa.eu/eli/reg/2016/679/oj"],
  "schemes":   [{ "key": "gdpr-personal-data", "name": "GDPR personal data" }],
  "terms":     [{ "key": "email-address", "kind": "CONCEPT", "term": "E-mail address",
                  "scheme": "gdpr-personal-data", "definition": "…", "aliases": ["email"] }],
  "relations": [{ "from": "email-address", "type": "BROADER", "to": "contact-data" }],
  "bindings":  [{ "mode": "OUTPUT",
                  "output": { "detectorType": "PII", "findingType": "EMAIL_ADDRESS" },
                  "termKey": "email-address" }]
}
```

- Terms and schemes are referenced by **key** (C8).
- Bindings use the C9 spec. A binding to a custom detector names `customDetectorKey`.
- A G2 detector bundle (C5) may carry the same object under `glossary`. Installing such a bundle installs its detectors and then their meaning.

### 8.2 Install, upgrade, uninstall

| Step | Behaviour |
|---|---|
| **Dry run** | Lists what will be created, updated or skipped, and which bindings wait for a missing detector |
| **Install** | Items get `origin: PACK` and `packKey`. Existing items with the same key are **not** overwritten; they are reported as conflicts with a per-item choice |
| **Upgrade** | A three-way diff (pack old → pack new, against local edits). Items edited locally are kept and flagged |
| **Uninstall** | Removes pack items nobody edited locally. Edited ones are kept and detached (`packKey = null`) |

Installed packs are listed under Glossary → Schemes, with their version.

### 8.3 Starter packs

These live in `packages/detector-packs/glossary/`. The contents below are a proposal: the pack author validates every mapping, and a spec pins the outputs bound against the detector catalogues (`PIIEnabledPattern`, and the SECRETS plugin type names in `detectors/secrets/detector.py`).

| Pack | Concepts (excerpt) | Bindings to built-in outputs |
|---|---|---|
| **GDPR personal data** | *Personal data* ⊃ *Identification data*, *Contact data*, *Financial data*, *Online identifiers*, *Special categories (Art. 9)* ⊃ *Health*, *Genetic*, *Biometric*, *Racial or ethnic origin*, *Political opinions*, *Religious or philosophical beliefs*, *Trade-union membership*, *Sex life or sexual orientation* | PII `PERSON` → *Person name*; `EMAIL_ADDRESS` → *E-mail address*; `PHONE_NUMBER` → *Phone number*; `LOCATION` → *Location or address*; `IP_ADDRESS` → *IP address*; `IBAN_CODE` → *Bank account (IBAN)*; `CREDIT_CARD` → *Payment card number*; national identifiers (`AT_SVNR`, `DE_TAX_ID`, `PL_PESEL`, `FI_PERSONAL_IDENTITY_CODE`, `IT_FISCAL_CODE`, `ES_NIF`, `ES_NIE`, `CH_AHV`, `EU_NATIONAL_ID`, `US_SSN`, `UK_NHS`, …) → *National identification number*; `NRP` → *Nationality, religious or political group*, RELATED → *Special categories*. Art. 9 concepts have no built-in binding; G2's Art. 9 detectors bind to them by key |
| **Secrets and credentials** | *Secret* ⊃ *Cloud credential*, *Source-platform token*, *API key*, *Private key*, *Password*, *Token*, *High-entropy string* | SECRETS type names such as `AWS Access Key` → *Cloud credential*; `Private Key` → *Private key*; `JSON Web Token` → *Token*; `Secret Keyword` and `Basic Auth Credentials` → *Password*; `Hex High Entropy String` and `Base64 High Entropy String` → *High-entropy string*. The full list is taken from the plugin map |
| **Financial identifiers** | *Financial identifier* ⊃ *Bank account*, *Payment card*, *Crypto address*, *Tax or VAT number*, *Business registration number* | PII `IBAN_CODE`, `CREDIT_CARD`, `CRYPTO`, `US_BANK_NUMBER`, `IT_VAT_CODE`, `AU_ABN`, `AU_ACN`, `SG_UEN`, … |
| **DACH company law** | Scheme *Rechtsformen* with register codes; company-law vocabulary from the Firmenbuch showcase (*Eigenmittelquote*, *Einzelvertretung* with hidden alias `E`, *EUID*, …), with sources cited | No built-in outputs. **Template bindings**: `OUTPUT_LOOKUP` on TAG keys `legal_form` and `representation`. They install as DRAFT and become APPROVED when a TAG detector with that key exists |

## 9. Agents (D7)

### 9.1 Tools

| Tool | Behaviour |
|---|---|
| `glossary.list_vocabulary` | Unbound and bound outputs and fields, with counts and suggestions. Read |
| `glossary.propose_binding` | Creates a DRAFT binding from a C9 spec, with a required rationale. Allowed in OBSERVE_ONLY too, since a proposal changes nothing |
| `glossary.preview_binding` | Runs the preview for a spec and returns counts, samples, lookup table and warnings. Returns a `previewToken`: an HMAC of spec, counts and time, valid for 30 minutes |
| `glossary.approve_binding` | Approves a DRAFT binding the agent proposed. Requires a `previewToken` for the same spec, so the agent must have looked |
| `glossary.disable_binding` | Disables an APPROVED binding **the agent approved**. Never an operator's |

### 9.2 Guardrails on `approve_binding`

| Check | Refusal (the binding stays DRAFT, with the reason in its rationale) |
|---|---|
| Mode and switch | Not MANAGED, or `autopilotGlossaryApproveEnabled` is off |
| Target | The target concept is not APPROVED. For lookups, the scheme has no APPROVED concepts |
| Conflict | An operator binding exists for the same output (and values) with a different meaning. Conflicts are an operator's call |
| Impact | The preview's open findings exceed `autopilotBindingImpactLimit` (default 5,000; `0` means no limit) |
| Budget | More than `autopilotGlossaryApprovalsPerDay` approvals today (default 20; shared with relation approvals, SL1) |
| Token | `previewToken` missing, expired, or for a different spec, or the counts moved by more than 20% since |

### 9.3 Recording and undo

Each successful approval writes:
- an `AgentDecision` with action `APPROVE_BINDING`, the rationale and the preview counts;
- an `AgentUndoEntry` with `revertKind: "restore_value"` and `revertPayload: { bindingId, status: "DRAFT" }`.

*Revert*, from the binding row or the Harness undo list, puts the binding back to DRAFT. SL3 then marks its links GONE.

The binding row shows *approved by autopilot* with the agent kind and run, linked to the decision.

### 9.4 Doctrine

Added to the glossary doctrine:
- bind the narrowest concept;
- prefer `OUTPUT_LOOKUP` for code-like categorical outputs;
- preview before approving;
- never bind open-valued outputs to an entity (entities link through mentions, G5);
- "no meaning" is an operator decision.

## 10. Data model (Prisma, tenant schema)

```prisma
enum GlossaryBindingMode {
  OUTPUT
  OUTPUT_VALUES
  OUTPUT_LOOKUP
  METADATA_VALUES
  METADATA_LOOKUP
}

enum GlossaryLookupMatch {
  CODES
  ANY
}

enum GlossaryBindingStatus {
  DRAFT
  APPROVED
  DISABLED
}

model GlossaryBinding {
  id                String                @id @default(uuid())
  mode              GlossaryBindingMode
  // Output selector (OUTPUT*). customDetectorKey is null for built-ins.
  detectorType      DetectorType?         @map("detector_type")
  customDetectorKey String?               @map("custom_detector_key")
  findingType       String?               @map("finding_type")
  // Field selector (METADATA*): a dotted path below `metadata`, depth <= 2.
  metadataPath      String?               @map("metadata_path")
  // OUTPUT_VALUES / METADATA_VALUES: normalised values (§4.4).
  values            String[]              @default([])
  splitDelimiter    String?               @map("split_delimiter")
  // Target: a concept, or a scheme to look values up in.
  termId            String?               @map("term_id")
  lookupSchemeId    String?               @map("lookup_scheme_id")
  lookupMatch       GlossaryLookupMatch?  @map("lookup_match")
  // §6.3: an explicit "this vocabulary has no meaning".
  noMeaning         Boolean               @default(false) @map("no_meaning")
  // Empty = every source.
  sourceIds         String[]              @default([]) @map("source_ids")
  confidence        Decimal               @default(1.00) @db.Decimal(3, 2)
  status            GlossaryBindingStatus @default(DRAFT)
  origin            GlossaryOrigin
  rationale         String?               @db.Text
  note              String?               @db.Text
  packKey           String?               @map("pack_key")
  createdBy         String?               @map("created_by")
  approvedBy        String?               @map("approved_by")
  approvedAt        DateTime?             @map("approved_at")
  disabledBy        String?               @map("disabled_by")
  disabledAt        DateTime?             @map("disabled_at")
  // sha256 of the normalised selector + target, so one binding cannot exist twice.
  fingerprint       String                @unique
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  term         GlossaryTerm?   @relation(fields: [termId], references: [id], onDelete: Cascade)
  lookupScheme GlossaryScheme? @relation(fields: [lookupSchemeId], references: [id], onDelete: Cascade)

  @@index([detectorType, findingType])
  @@index([customDetectorKey])
  @@index([termId])
  @@index([lookupSchemeId])
  @@index([status])
  @@map("glossary_bindings")
}

model VocabularyItem {
  sourceId          String       @map("source_id")
  detectorType      DetectorType @map("detector_type")
  // '' for built-ins, so it can sit in the primary key.
  customDetectorKey String       @default("") @map("custom_detector_key")
  findingType       String       @map("finding_type")
  openCount         Int          @map("open_count")
  assetCount        Int          @map("asset_count")
  distinctValues    Int?         @map("distinct_values")
  topValues         Json?        @map("top_values") @db.JsonB
  firstSeenAt       DateTime     @map("first_seen_at")
  lastSeenAt        DateTime     @map("last_seen_at")
  refreshedAt       DateTime     @map("refreshed_at")

  @@id([sourceId, detectorType, customDetectorKey, findingType])
  @@index([detectorType, customDetectorKey, findingType])
  @@map("vocabulary_items")
}

model VocabularyField {
  sourceId       String   @map("source_id")
  path           String
  assetCount     Int      @map("asset_count")
  distinctValues Int?     @map("distinct_values")
  topValues      Json?    @map("top_values") @db.JsonB
  refreshedAt    DateTime @map("refreshed_at")

  @@id([sourceId, path])
  @@map("vocabulary_fields")
}
```

**Constraints, checked in the service and refused with HTTP 400 naming the field:**

| Mode | Must have |
|---|---|
| `OUTPUT*` | `detectorType` and `findingType`; `customDetectorKey` exactly when `detectorType = CUSTOM` |
| `METADATA*` | `metadataPath` |
| `*_VALUES` | At least 1 and at most 1,000 values |
| `*_LOOKUP` | `lookupSchemeId` and `lookupMatch`, and `termId = null` |
| Everything else | `termId` (unless `noMeaning`), and the target must be a CONCEPT |

**Other changes:**
- `custom_detectors` gains nullable `generated_from_term_id` and `generated_labels_hash` (§7).
- `glossary_activities` gains `bindingId`.
- The migration creates `glossary_norm(text)` as an immutable SQL function in the tenant schema (integration rule 1).

## 11. API (REST)

| Method and path | Purpose |
|---|---|
| `GET /semantic/vocabulary?kind=outputs\|fields&sourceId=&detectorType=&bound=true\|false\|any&q=` | Inventory rows with their bindings and suggestions (SL4) |
| `POST /semantic/vocabulary/refresh` (`{ sourceId? }`) | Queue a refresh |
| `GET /semantic/vocabulary/values?output=…\|field=…&limit=` | Top values with counts, for the pickers. Served from the inventory, and live only for outputs below 50,000 findings, with a 3 s timeout |
| `POST /semantic/bindings/preview` (C9 spec) | §6.1 preview |
| `GET /semantic/bindings?termId=&status=&output=&origin=` | List |
| `POST /semantic/bindings` (C9 spec plus `status`) | Create. Operators may create APPROVED |
| `PATCH /semantic/bindings/:id` | Edit a DRAFT. An APPROVED binding is edited by disabling it and creating a new one, so history stays honest |
| `POST /semantic/bindings/:id/approve`, `/disable`, `/enable` | §4.5 |
| `DELETE /semantic/bindings/:id` | DRAFT or DISABLED only |
| `POST /glossary/terms/:id/find-in-text` (`{ labels, wholeWords, continuations, severity, sourceIds }`) | §7. Returns `{ customDetectorId, bindingId, testResults }` |
| `POST /semantic/packs/install` (`{ pack, dryRun, resolutions? }`), `POST /semantic/packs/:key/upgrade`, `DELETE /semantic/packs/:key` | §8.2 |
| `GET /semantic/packs` | Installed packs, plus the bundled starter packs available to install |

## 12. MCP

All in group `glossary`:
- `list_vocabulary`
- `preview_binding`
- `list_bindings`
- `create_binding` (operator level, as MCP writes are today)
- `approve_binding`, `disable_binding`
- `find_term_in_text`
- `install_glossary_pack` (`dryRun` defaults to true)

Schemas reuse C9 through `strictObject`.

## 13. Events, transfer, cleanup, demo mode

| Area | Behaviour |
|---|---|
| **Events (F1)** | `glossary.binding_changed` (`created | approved | disabled | enabled | deleted`, with mode, output and term key); `glossary.pack_installed` (counts). Aggregate: one event per pack install, not per binding |
| **Data transfer** | `glossaryBinding` (order 820) in scope `glossary`. `vocabularyItem` and `vocabularyField` are listed as deliberately absent (derived; rebuilt by a refresh after import) |
| **Cleanup** | Bindings join the protected `glossary` dataset. The vocabulary tables are a cleanable derived dataset, *Vocabulary inventory*, with rebuild |
| **Demo mode** | Writes blocked; previews and inventory reads allowed |

## 14. Performance

| Operation | Target |
|---|---|
| Inventory refresh | ≤ 30 s at p95 for a source with 2 M open findings; value statistics bounded as in §5.2 |
| Binding preview | ≤ 5 s timeout. Lookup previews group by distinct value first, then join `glossary_terms` once per distinct value through the `matchKeys` GIN index or `codes` |
| Meaning card | Evaluates the cached APPROVED bindings in memory. The cache is invalidated by `glossary.binding_changed`, and stays under 1 ms per finding |
| Bindings per workspace | Expected in the hundreds; guarded at 5,000, with HTTP 400 beyond |

## 15. Rollout

1. **PR 1:** inventory tables, refresh queue and API (no UI).
2. **PR 2:** binding model, compiler and conformance spec, preview and CRUD API.
3. **PR 3:** the dialog, *Unbound vocabulary*, and the detector page's Meaning tab, together with SL3's first linker PR, so saving produces links.
4. **PR 4:** "Find in text".
5. **PR 5:** packs (format, install, starter packs).
6. **PR 6:** agent tools and guardrails.

## 16. Testing

- **Compiler:** the conformance spec in §4.6 covers every mode, scopes, split values, NFKC and case-folding, lookup `CODES` vs `ANY`, ambiguous values, deprecated targets and `noMeaning`.
- **Inventory:** categorical vs open-valued classification; caps; skipped internal fields; refresh coalescing, including completed jobs holding the singleton slot (integration rule 8).
- **Dialog (web):** the smart-default table in §6.1 as unit tests over inventory fixtures; the redundancy warning; the unmatched-values flow.
- **Find in text:**
  - generated pattern escaping (labels containing `.`, `+`, `(`, umlauts);
  - identical matches under google-re2 and the stdlib `re` fallback, for the same fixture texts (boundary rule, §7);
  - case-sensitive codes inside a case-insensitive group;
  - tests fail when a label is excluded;
  - regeneration bumps the version.
- **Packs:** dry run; conflicts; upgrade with local edits; uninstall keeping edited items; DRAFT *waiting for detector* turning APPROVED when the TAG detector appears.
- **Agents:** every guardrail in §9.2 refuses as specified; approve then revert round-trips; token expiry.
- **E2E:** scenario D, steps 2–4, and scenario F, step 2 (SL0 §7).

## 17. Risks

| Risk | Mitigation |
|---|---|
| People expect regex and are confused by its absence | The dialog explains it in one line and links to "Find in text" and the REGEX detector editor |
| A popular output is bound wrongly, and thousands of findings get the wrong meaning | Preview counts; one-click disable; SL3 makes links GONE quickly; agents are capped by the impact limit |
| Inventory refresh load on large sources | Coalescing, bounded value statistics, statement timeouts, off the scan's critical path |
| Packs drift from the detector catalogues | A spec pins pack outputs against `PIIEnabledPattern` and the SECRETS plugin list |
| Lookup ambiguity across concepts in one scheme | Surfaced as *ambiguous* with candidates, never guessed |

## 18. Acceptance criteria

- [ ] From a TAG finding `legal_form = GES`, the dialog opens on *Each value names a term* with the right scheme preselected. The preview shows the value table; saving links every matching asset without a re-scan (with SL3).
- [ ] From a PII `IBAN_CODE` finding, the dialog opens on *Every finding of this kind*.
- [ ] *Unbound vocabulary* lists outputs by volume. *No meaning* removes an item and raises coverage.
- [ ] "Find in text" for *Eigenmittelquote* creates a REGEX detector with passing tests, plus a binding. A scan of an attached source produces linked findings.
- [ ] The GDPR starter pack installs and binds PII outputs; uninstall removes untouched items.
- [ ] An agent can propose, preview, approve and later disable its own binding. Every guardrail refuses as specified; an operator can revert from the undo list.
- [ ] The compiler conformance spec is green.

## 19. Definition of done

The integration architecture's §9 and SL0 §12.

## 20. Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Should a binding carry a confidence below 1.0 ("probably means")? | The column exists and defaults to 1.0. The UI exposes it only under *Advanced* |
| Q2 | Should *No meaning* be per source as well as global? | Global, with the source scope of §4.1 applying |
| Q3 | Should bindings on G4's typed finding fields come in SL2 v2, as a step towards concept properties? | After G4 ships, as a separate PRD |

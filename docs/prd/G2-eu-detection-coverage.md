# PRD G2 · European detection coverage and shareable detectors

| | |
|---|---|
| **Status** | Proposed |
| **Size** | S–M (three parts that can ship independently) |
| **Milestone** | M2 · Europe ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | nothing blocking. Part C can carry PYTHON detectors once [G1](G1-python-detector.md) ships |
| **Provides** | Foundation **F5**: detector bundles, the portable detector file format |
| **Used by** | [G1](G1-python-detector.md) (sharing rules), the starter-example catalogue, the public detector-pack gallery, [G7](G7-outcome-metrics.md) (bundled test scenarios give baseline precision) |

## 1. Summary

Three parts:

- **A. National identifiers for Europe.** Recognizers with checksum validation for the member states we don't cover, plus EU VAT numbers. Checksums are added to the DACH recognizers that have none today.
- **B. GDPR special categories (Art. 9).** Health, ethnic origin, political opinion, religion or belief, trade-union membership, sex life or orientation, genetic and biometric data, shipped as ready-to-use detectors with multilingual test sets.
- **C. Detector bundles.** A versioned JSON file format to export and import detectors with their test scenarios. It makes Parts A and B, the PYTHON rules and community packs shareable between instances.

## 2. Why

The target market is enterprises and government in Europe. Their first scan decides whether Classifyre is worth a second look, and today it under-reports European data:

- **National IDs.** The PII detector knows 41 entity types (`PIIEnabledPattern` in `all_detectors.json`). Dedicated national-ID recognizers exist for **6 of the 27 member states**: Austria, Germany, Spain, Finland, Italy and Poland. There are also Switzerland, the UK NHS number and a loose generic `EU_NATIONAL_ID` (`[A-Z]{2}[ -]?\d{6,12}` plus context). A French, Dutch, Belgian, Swedish, Danish, Portuguese, Irish, Czech or Romanian evaluator will not see their own ID numbers found.
- **Weak DACH checks.** Those recognizers are regex plus context with no checksum. `DE_TAX_ID` scores 0.4 and "needs context" (`apps/cli/src/detectors/pii/detector.py`), although the Steuer-IdNr has a check digit. Checksums raise precision, and reviewer time is the product's bottleneck. Both first-use retrospectives found that judgment, not extraction, is what limits the product.
- **Special categories.** GDPR Art. 9 data is what data-protection officers must find first: it carries the strictest processing conditions and drives DPIAs. Classifyre has no detector for it. `NRP` (nationality, religion, political group) is the closest built-in, and it is a Presidio entity, not a classifier.
- **No sharing.** There are 28 starter examples (`all_detectors_examples.json`, three of them DACH-specific), but no way to export a tuned detector from one instance and import it into another. Namespace data transfer (`.cfyre`) moves whole workspaces, not single detectors. An open-source ecosystem grows on shareable artefacts. Semgrep rules, YARA rules and Nuclei templates are the pattern.

## 3. Goals

- Every member state has at least its primary personal identifier detected, with a checksum wherever the format has one, and without flooding reviewers.
- A DPO can enable an "EU/EEA" preset in one click on the PII detector.
- Special-category data is detected in at least English, German, French, Dutch, Spanish and Italian, with measured precision and recall on shipped test sets.
- Any custom detector (regex, GLiNER2, LLM, classifier, TAG, PYTHON) can be exported as a file and imported elsewhere, with its tests, and verified on import.

## 4. Non-goals

- Passport and driving-licence formats for every member state (v2, driven by demand).
- Legal classification: *detecting* Art. 9 data is in scope, *deciding* the lawful basis is not.
- A hosted marketplace. Packs live in the repository (`packages/detector-packs/`) and the docs gallery lists them.

## 5. Requirements

### Part A: national identifiers

| # | Requirement | Priority |
|---|---|---|
| A1 | New `PIIEnabledPattern` values, one per identifier in §6.1, each a Presidio `PatternRecognizer` subclass with `validate_result()` implementing the checksum | MUST |
| A2 | Add checksum validation to `DE_TAX_ID` (ISO 7064 MOD 11,10 plus its digit-repetition rule), `AT_SVNR` and `CH_AHV` (EAN-13). Raise their base score when the checksum passes | MUST |
| A3 | Scoring: checksum-valid **and** a context word present → high (≥ 0.85). Checksum-valid only → medium (0.5–0.6). Formats with weak structure (9-digit BSN, CPR without a checksum) → low (≤ 0.3) unless there is context. The detector's existing threshold decides what becomes a finding | MUST |
| A4 | Context words in the identifier's own language(s), plus EN and DE. Column-name hints for tables (`bsn`, `burgerservicenummer`, `nir`, `insee`, `personnummer`, `cpr`, `ppsn`, `cnp`, `egn`, `oib`, `emso`, `amka`, `isikukood`, `asmens_kodas`, `personas_kods`, `taj`, `matricule`, `rodne_cislo`), extending the existing hint map (`"svnr": {"AT_SVNR"}`, …) | MUST |
| A5 | EU VAT numbers (`EU_VAT`) for all 27 member states: country prefix, per-country format and checksum where one exists | MUST |
| A6 | Presets on the PII detector: **Global** (today's default, unchanged), **EU/EEA** (all EU national IDs, EU VAT, IBAN, email, phone, person) and **DACH**. Existing detector configurations are **never** changed silently | MUST |
| A7 | Correlation: every new identifier label is **non-phonetic** and weighted as an identifier. Generate the identifier label set from the PII entity catalogue, so `NON_PHONETIC_LABELS` (`correlation/correlation.constants.ts`) cannot drift again. The set today lists `national_id`, `ssn`, `iban` and others, but not the per-country labels | MUST |
| A8 | Test vectors per identifier: valid samples from official documentation, plus invalid ones (wrong checksum, impossible dates). In tests only, cross-check our validators against `python-stdnum` as a **dev dependency** | MUST |
| A9 | Implement the validators ourselves, as small pure functions. `python-stdnum` is LGPL-2.1+; keeping it out of the runtime keeps the Apache-2.0 distribution and a future enterprise build simple | SHOULD |

### Part B: special categories (Art. 9)

| # | Requirement | Priority |
|---|---|---|
| B1 | Ship two detectors as bundles: **"GDPR special categories (zero-shot)"** on GLiNER2 classification, and **"GDPR special categories (LLM)"** with labels plus output fields `category`, `evidence_quote`, `subject_type` (`employee` \| `customer` \| `patient` \| `other`), `confidence_reason` | MUST |
| B2 | Labels: `health`, `ethnic_origin`, `political_opinion`, `religious_belief`, `trade_union`, `sex_life_orientation`, `genetic`, `biometric`. Finding types: `gdpr_art9:<label>`, category `PRIVACY`, severity HIGH, or CRITICAL for `health`, `genetic` and `biometric` | MUST |
| B3 | Multilingual evaluation sets: at least 40 positive and 40 negative synthetic snippets per language for EN, DE, FR, NL, ES and IT, shipped as test scenarios in the bundle. No real personal data | MUST |
| B4 | Published quality bar: precision and recall per label and language, measured through the existing test-scenario runner. Record them in the bundle metadata and show them on import. If the default GLiNER2 model (`fastino/gliner2-base-v1`) underperforms in a language, the bundle names a better multilingual model | MUST |
| B5 | Default scope: text-bearing assets only (`DetectorScope.content_types: ["text/", "application/pdf", …]`) and a `DetectorBudget` suited to LLM cost | MUST |

### Part C: detector bundles (F5)

| # | Requirement | Priority |
|---|---|---|
| C1 | File format `classifyre.detector-bundle/v1` (JSON, §6.3). One bundle holds one or more detectors | MUST |
| C2 | Export: `GET /custom-detectors/export?keys=…` downloads a bundle. Secrets are stripped by the same credential guard as namespace transfer (`enc::v1::` values never leave the instance). Training examples and detector files are included only when explicitly asked | MUST |
| C3 | Import: `POST /custom-detectors/import` with `dryRun`. It validates the bundle and reports conflicts per key: **skip**, **rename** (new key) or **replace** (version bump, keep history). It binds LLM detectors to a chosen `AiProviderConfig`, runs the bundled test scenarios after import, and returns a report | MUST |
| C4 | Imported PYTHON detectors are **inactive** until a person activates them in the UI, with the code shown before activation | MUST |
| C5 | MCP: `export_custom_detectors` (read) and `import_custom_detectors` (write, in the `custom_detectors` group; PYTHON content additionally requires `custom_source_code`). The autopilot may export but never import | MUST |
| C6 | `packages/detector-packs/<pack>/bundle.json` plus a `README.md`. CI validates every pack (schema check plus test scenarios in the CLI) and fails on regressions. The docs gallery page is generated from the packs | MUST |
| C7 | The starter-example catalogue (`all_detectors_examples.json`) is served from bundles, so "start from example" and "import pack" share one format | SHOULD |
| C8 | Web: "Import" and "Export" on the detectors page. The import dialog shows conflicts, provider binding, test results, and a code review step for PYTHON detectors | MUST |

## 6. Design

### 6.1 Identifier catalogue (Part A)

Formats and algorithms are listed so the team can size the work. **Each implementation must be verified against the official specification and test vectors (A8)**; this table is a map, not the spec.

| Entity | Country | Identifier | Validation |
|---|---|---|---|
| `FR_NIR` | FR | Numéro d'inscription au répertoire (13 + 2-digit key) | key = 97 − (NIR mod 97), with Corsica 2A/2B substitution |
| `NL_BSN` | NL | Burgerservicenummer (9 digits) | "11-proef" weighted sum; weak without context |
| `BE_NRN` | BE | Rijksregisternummer / numéro national (11) | mod 97 check, with the post-2000 "2" prefix rule |
| `SE_PERSONNUMMER` | SE | Personnummer and samordningsnummer (10/12) | Luhn on 10 digits; date validity |
| `DK_CPR` | DK | CPR-nummer (10) | Date validity only: modulus 11 is not guaranteed for numbers issued since 2007; context required |
| `NO_FNR` | NO (EEA) | Fødselsnummer (11) | Two mod-11 check digits |
| `PT_NIF` | PT | Número de identificação fiscal (9) | mod 11 check digit |
| `IE_PPSN` | IE | Personal Public Service Number (7 digits + 1–2 letters) | Weighted sum mod 23 → check letter |
| `CZ_SK_RC` | CZ, SK | Rodné číslo (9/10) | 10-digit numbers divisible by 11 (with the historic remainder-10 exception); month +50/+20 offsets |
| `RO_CNP` | RO | Cod numeric personal (13) | Weighted mod 11 (weights 279146358279) |
| `BG_EGN` | BG | ЕГН (10) | Weighted mod 11; century encoded in the month |
| `GR_AMKA` | GR | ΑΜΚΑ (11) | Luhn; date prefix |
| `HR_OIB` | HR | OIB (11) | ISO 7064 MOD 11,10 |
| `SI_EMSO` | SI | EMŠO (13) | Weighted mod 11 |
| `EE_IK`, `LT_AK` | EE, LT | Isikukood / asmens kodas (11) | Two-stage weighted mod 11 |
| `LV_PK` | LV | Personas kods (11) | Weighted check for the old format; the new format (prefix 32) has none, so context is required |
| `HU_TAJ` | HU | TAJ-szám (9) | Alternating 3/7 weights mod 10 |
| `LU_MATRICULE` | LU | Matricule (13) | Luhn and Verhoeff check digits |
| `DE_SVNR` | DE | Rentenversicherungsnummer (12, contains a letter) | Weighted cross-sum check digit |
| `EU_VAT` | all 27 | VAT identification number | Per-country format; checksum where defined |

**Not in v1.** Malta and Cyprus ID cards (no checksum; context-only, weak) and passports. Track them as community-contributed PYTHON detectors ([G1](G1-python-detector.md)).

**Code layout.**
- `apps/cli/src/detectors/pii/recognizers/eu/`: one module per country with `validate(value) -> bool` and a `RecognizerSpec(entity, name, patterns, context, column_hints, validator)`.
- A generic `ChecksumPatternRecognizer(PatternRecognizer)` calls `validator` in `validate_result`.
- Registration follows `_register_regional_recognizers`, which already de-duplicates against predefined entities. Recognizers are registered under `"en"`, as the DACH set is today.
- Context words in other languages still match lexically. Lemma-based enhancement will be weaker for them, and A8 test sentences must cover this.

**Schema.** Add the entities to `PIIEnabledPattern` in `all_detectors.json`, then regenerate the CLI models. The UI groups the PII entity picker by country (web: the PII detector config card), with the presets on top.

### 6.2 Special categories (Part B)

- **GLiNER2 bundle.** A `classification` task `gdpr_art9` with the eight labels plus `none`, and `validation.confidence_threshold` tuned per label from the B3 sets. The existing runner emits `classification:<task>:<label>` finding types (`_base.py`). The bundle maps them to `gdpr_art9:<label>` through its label definitions, or the runner gains an optional `finding_type_template`, a small change.
- **LLM bundle.** `LLMPipelineSchema` with the eight labels, `severity_map`, `output_fields` (B1) and a system prompt that asks for a verbatim `evidence_quote`. Quotes make review fast and keep hallucinated classifications visible.
- **Test sets.** Written by the team as synthetic text, reviewed by a native speaker per language, stored in the bundle's `testScenarios`.

### 6.3 Bundle format (Part C, F5)

```jsonc
{
  "kind": "classifyre.detector-bundle/v1",
  "name": "gdpr-special-categories",
  "description": "GDPR Art. 9 special categories, EN/DE/FR/NL/ES/IT",
  "version": "1.2.0",                       // the pack's own semver
  "minClassifyreVersion": "0.7.0",
  "exportedAt": "2026-10-01T12:00:00Z",
  "detectors": [
    {
      "key": "gdpr_art9_llm",
      "name": "GDPR special categories (LLM)",
      "description": "…",
      "category": "PRIVACY",
      "pipelineSchema": { "type": "LLM", "...": "secrets stripped" },
      "requires": { "aiProvider": { "chat": true, "vision": false } },
      "testScenarios": [ { "name": "…", "inputText": "…", "expectedOutcome": { } } ],
      "trainingExamples": [],                // only when exported with ?include=training
      "files": [],                           // PYTHON detector files, only with ?include=files
      "quality": { "precision": { "health:de": 0.93 }, "recall": { "health:de": 0.88 } }
    }
  ],
  "checksum": "sha256:…"                     // over the canonical JSON of `detectors`
}
```

- **Serializer.** Share it with namespace data transfer (`apps/api/src/data-transfer/`), so redaction rules are defined once. The transfer scope registry stays the single source of truth for which columns never leave (`transfer-scopes.ts`).
- **Import.** Runs in one transaction per detector. Test scenarios run afterwards through `CustomDetectorTestsService`. Failures are reported and do not roll back, because a detector that imports but fails a test is still useful to inspect.
- **Domain events** ([F1](00-integration-architecture.md#f1-domain-events)): `detector.imported` and `detector.exported`, with the bundle name and version.

## 7. How it connects

| With | What flows |
|---|---|
| [G1](G1-python-detector.md) | PYTHON detectors travel in bundles, imported inactive (C4). Unshipped identifiers can be community PYTHON packs |
| **F4** value index ([G5](G5-entities.md)) | A7 keeps national IDs non-phonetic and high-weight. They become the strongest entity identifiers (a person's BSN links their mentions exactly) |
| [G4](G4-extracted-values-and-watch-conditions.md) | Art. 9 LLM output fields (`subject_type`) are queryable: "health data about employees in shared drives" |
| [G7](G7-outcome-metrics.md) | Bundle quality metadata is the *expected* precision; G7 shows the *observed* precision from verdicts, side by side |
| [G3](G3-outbound-webhooks-notifications-export.md) | A DPO subscribes a channel to `inquiry.new_matches` for an Art. 9 watch |

## 8. Rollout

- A and B ship behind no flag. New entities are opt-in through presets or the picker, and existing PII configurations don't change (A6).
- Release notes name every new identifier. The docs get a "Europe" page mapping identifiers to countries.

## 9. Testing and acceptance

- **Per identifier:** valid vectors detected, invalid checksums rejected, impossible dates rejected, 100 % agreement with `python-stdnum` on a generated sample of 10k valid and 10k invalid values (dev-only test).
- **False-positive budget:** on a 50 MB mixed corpus with no personal data (code, logs, invoices with order numbers), the EU/EEA preset adds fewer than 1 finding per MB at the default threshold.
- **Special categories:** the published precision and recall (B4) meet at least 0.85 precision per label for EN and DE before release, and the numbers are recorded for the other languages.
- **Bundles:** a round trip (export on instance A, import on instance B) yields identical detectors (except ids and provider binding) and passing tests. A tampered bundle fails the checksum. A bundle with a secret-shaped value is refused at export.
- **E2E:** import the GDPR pack, run it on a fixture source, see `gdpr_art9:health` findings with evidence quotes.

## 10. Success measures

- First-scan coverage: on a synthetic "European HR share" fixture with one document per member state, the EU/EEA preset finds the primary ID in at least 25 of 27 states.
- At least three community-contributed packs within two releases after C ships.

## 11. Open questions

- Should the EU/EEA preset become the default for **new** PII detectors when the instance language is German, or when the instance is in the EU? Explicit is better; the recommendation is to ask during first-run setup.

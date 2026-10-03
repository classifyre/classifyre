# PRD G1 · PYTHON detector (rules, checks and bring-your-own-model)

| | |
|---|---|
| **Status** | Proposed |
| **Size** | M |
| **Milestone** | M1 · Extensibility ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | nothing blocking. Uses [S1](S1-enterprise-extension-seams.md) (`detectors.manage_code` action) when present |
| **Provides** | `identity_key` and `normalized_value` on detection results (contracts **C1**, **C2** in the [integration doc](00-integration-architecture.md#5-cross-feature-contracts)); a writer of extracted fields for **F3** |
| **Used by** | [G2](G2-eu-detection-coverage.md) (users add IDs we don't ship), [G4](G4-extracted-values-and-watch-conditions.md) (conditions over rule output), [G5](G5-entities.md) (normalised values), [G7](G7-outcome-metrics.md) (precision per rule) |

## 1. Summary

A new custom-detector engine, `PYTHON`, next to REGEX, GLINER2, LLM, the classifiers and TAG. The author writes a notebook with a `detect(asset, ctx)` function. It runs in the scan's detector stage, once per asset, can read the asset's text, pages, raw bytes, rows and metadata, and yields findings with a location, an optional severity and optional structured fields.

It reuses the notebook runtime that CUSTOM sources and augmentation already use: child process, package installation, secrets and limits. It plugs into everything detectors already have: scope, budget, per-detector scan cache, test scenarios, false-positive feedback, resolution when a check stops firing, inquiries, cases and the autopilot's view of findings.

A detector **judges**; it never rewrites what the connector extracted. Cleaning and transformation stay in CUSTOM derived sources and augmentation.

## 2. Why

### 2.1 The rules exist, but they live in the wrong place

Today every computed rule is Python inside a connector or augmentation notebook. It asserts `Asset(tags={"<detector key>": "<value>"})`, and a TAG detector (a placeholder that "runs no classification and never reads content", per `TagPipelineSchema` in `all_detectors.json`) turns the tag into a finding.

The GENESIS build shows the result at scale: 20 CUSTOM sources, **68 detectors of which 67 are TAG and 1 is REGEX**. The field report's own review: the corpus "exercises ingestion and casework but not the detection engine" (`docs/architecture/GENESIS_FIELD_REPORT.md`). Three shipped platform fixes were symptoms of rules living in connectors:

| Field report | Symptom | Root cause |
|---|---|---|
| **P4** | A check that stopped firing never resolved its finding | A TAG outcome is only recorded for keys the asset currently carries |
| **P6** | Duplicate review had 3,556 pairs, none of them duplicates | Templated tag values ("abgeleitete Geburten 28.083 vs. …") correlated phonetically |
| **P9** | Two detectors per rule | One severity per TAG detector |

Structural costs remain even after those fixes:
- An augmentation notebook belongs to **one source**, so a rule is copied into every source that needs it.
- Changing a rule means **re-extracting the source**.
- A TAG gives **one finding per key per asset**, with **no location** (which row? which page?).
- **Test scenarios, training, false-positive feedback and the per-detector scan cache** don't apply to rules at all.

### 2.2 It is also the missing extension point

For open-source traction, extensibility is what users build on and contribute. Users can already write connectors in Python, but not checks. Many European use cases in the [gap analysis](../../palantir-use-case-gap-analysis.md) are checks:
- integrity of published statistics;
- screening names against a sanctions list;
- "an IBAN and a health term in the same document";
- quality and bias checks on AI training data (AI Act Art. 10);
- a national ID we don't ship yet.

Detectors today can't express these, because they receive only page text (`BaseDetector.detect(content, content_type)`, `apps/cli/src/detectors/base.py`). A table arrives as rendered text, not rows.

## 3. Goals

- A rule written once can be attached to any number of sources, like any custom detector.
- A rule sees rows, bytes, text, pages, metadata, and the findings other detectors produced on the same asset in this run.
- Rule findings carry a location, a message, optional structured fields and a stable identity, so re-runs update findings instead of churning them.
- A rule that stops firing resolves its finding (the P4 guarantee) through the normal detector outcome mechanism.
- Authors get the notebook editor, package installation, a preview on a real asset, and test scenarios.
- Failures are contained: one broken rule never fails a scan or another detector.

## 4. Non-goals

- **Rewriting content.** Cleaning and transformation stay in CUSTOM derived sources and augmentation (additive only).
- **Cross-asset rules** in v1: a district compared with all districts, or totals across files. These stay in derived sources, or come later through `finalize()` (see §12).
- **A sandbox.** Isolation is the same process boundary and scrubbed environment as CUSTOM notebooks. [G0](G0-safe-defaults.md) documents the consequence.
- **Autopilot-authored code in v1.** Agents may propose rules but cannot create or activate them (R24).

## 5. Users and scenarios

1. **Statistics integrity (GENESIS).** "Every dimension of this table has a total row, and the total equals the sum of its parts." The finding carries row and column locations and `{expected, actual}` fields. Today this is `de_dq_no_total_row` asserted from a notebook.
2. **List screening.** Load a sanctions or PEP list (uploaded CSV) in `setup()`. In `detect()`, match person and organisation findings from the PII or GLiNER2 detectors that ran earlier on the same asset, using fuzzy matching. Yield a finding with the list entry id as `normalized_value`.
3. **Composite rule.** "An IBAN and a special-category term in the same document shared with more than 50 people" uses prior findings plus asset metadata.
4. **Bring your own model.** Load a scikit-learn or ONNX model from an uploaded file and score each row or page. Findings carry the score as a field.
5. **Unshipped identifier.** A Slovenian user adds EMŠO validation with a checksum as a PYTHON detector and shares it as a bundle ([G2](G2-eu-detection-coverage.md)).

## 6. Requirements

### Authoring and contract

| # | Requirement | Priority |
|---|---|---|
| R1 | `PYTHON` is a new `AnyPipelineSchema` variant in `packages/schemas/src/schemas/all_detectors.json`: `notebook`, `packages`, `variables`, `secrets`, `files`, `fields`, `scope`, `budget`, `severity`, `category`, `deterministic`, `needs_findings`, `limits`. The CLI models are regenerated (`apps/cli` → `bun codegen`) | MUST |
| R2 | Contract: `detect(asset, ctx)` is required; `setup(ctx)` is optional. It is validated on save, before a preview and before every scan, the same three moments as the CUSTOM contract (`apps/cli/src/notebook/contract.py`). This reuses `validate_module(..., required=("detect",))` | MUST |
| R3 | `detect` may `yield` or `return` a list of `Finding(label, value, *, severity=None, confidence=1.0, location=None, message=None, fields=None, normalized_value=None, identity=None)` | MUST |
| R4 | `asset` is read-only and exposes the augmentation readers: `payload()`, `raw_pages()`, `rows()`, `text()`, `pages()`, plus `id`, `name`, `kind`, `url`, `urn`, `source_type`, `mime_type`, `metadata` | MUST |
| R5 | With `needs_findings: true`, `asset.findings` lists the findings other detectors produced on this asset in this run: detector, type, value, severity, confidence, location. PYTHON detectors then run after all other detectors on the asset. PYTHON detectors never see each other's findings (no ordering between rules) | MUST |
| R6 | `ctx` is the notebook `Context` (`var`, `secret`, `file`, `files`, `log`, `now`) plus `state`, a per-run dictionary filled in `setup()` | MUST |
| R7 | Uploaded **detector files** (lists, models, reference tables) are available through `ctx.file(name)`, stored like source files (`UploadedSourceFile` holds bytes in Postgres) in a new `custom_detector_files` table | MUST |
| R8 | `fields` declares output fields `{name, type: string\|number\|boolean\|date\|list[string]\|list[number], description}`. Undeclared keys in `Finding.fields` are dropped with one warning per run per key | MUST |

### Semantics

| # | Requirement | Priority |
|---|---|---|
| R9 | Each finding becomes a `DetectionResult` with `detector_type=CUSTOM`, `custom_detector_key`, `finding_type=label`, `category` (detector setting, default `QUALITY`), `matched_content=value`, `extraction_method="PYTHON"`. `message`, `normalized_value` and `severity_requested` go to `metadata`, and `fields` to `extracted_data` | MUST |
| R10 | **Stable identity (contract C1):** `identity` becomes `identity_key` on the wire. The API derives `detectionIdentity` from it *instead of* the matched content, so "total 523 ≠ 520" and "total 524 ≠ 520" on the same row are one finding whose value changed, not two findings | MUST |
| R11 | **Severity ceiling:** the detector's `severity` is a ceiling, as for Tag (P9). A higher per-finding request is clamped and recorded as `metadata.severity_requested` | MUST |
| R12 | **Resolution:** after `detect` returns without error, the pipeline records an `OK` outcome for this detector on this asset, whether or not it yielded findings. A previously open finding that is not yielded again is then resolved by the existing `finalizeIngestRun` rule. This is the P4 guarantee | MUST |
| R13 | **Normalised values (contract C2):** `normalized_value` feeds the value index (`asset_correlation_values`) under the finding's label. Findings without it never enter correlation. This prevents the P6 noise by construction | MUST |
| R14 | `location` accepts the wire `Location` fields (`path`, `description`, `line`, `column`, `start`, `end`) plus `row` and `column_name`, which map to `metadata.tabular_row_index` and `metadata.tabular_column_name`, the PII detector's existing convention | MUST |

### Execution, limits and cache

| # | Requirement | Priority |
|---|---|---|
| R15 | `DetectorScope` (asset kinds, content types, metadata predicate) is applied before any child call. Out-of-scope assets record no outcome, so their findings are left untouched, as today | MUST |
| R16 | Limits with defaults: `per_asset_timeout_seconds` 30, `max_findings_per_asset` 200, `max_output_bytes` 2 MiB, `max_workers` 1, `max_consecutive_failures` 10. These match augmentation's `_DEFAULT_LIMITS` | MUST |
| R17 | Failure containment: an exception, timeout or malformed output on one asset produces a scan warning and an `ERROR` outcome for that detector on that asset. Existing findings are never resolved by a failed check. `DetectorBudget` and the per-detector breaker apply | MUST |
| R18 | Scan cache: the detector fingerprint includes the code, packages, variables, file hashes, fields, limits and the engine version. Secrets are excluded. `deterministic: false` makes the detector non-cacheable, like `BROKEN_LINKS` | MUST |
| R19 | Each run installs packages once per scan (uv), as augmentation does. Secrets are decrypted only into the child's `ctx`, never into logs (reuse notebook redaction) | MUST |
| R20 | Payload is fetched at most once per asset, even when augmentation and several PYTHON detectors run on it: one shared payload server with a per-asset memo | MUST |

### Product surfaces

| # | Requirement | Priority |
|---|---|---|
| R21 | Web: "Python rule" in the detector type selector; an editor with cells, packages, variables, secrets, files, fields, scope, budget, severity ceiling and category; five starter templates (§7.6) | MUST |
| R22 | **Preview on a real asset:** pick a source and an asset, run `detect`, and show the findings with locations, fields and logs. This uses a `NotebookExecution` with scope `DETECTOR` and mode `PREVIEW_DETECT` | MUST |
| R23 | **Test scenarios with asset fixtures:** `CustomDetectorTestScenario` accepts `inputAsset` (name, kind, mime, metadata, text / pages / rows) besides `inputText`. The expected outcome lists findings by label and identity or value, with optional severity and count | MUST |
| R24 | Autopilot: the DETECTOR_AUTHOR agent cannot create, update or activate PYTHON detectors in v1. It may propose one as an operator notification containing the code. MCP code-writing tools require the existing `custom_source_code` capability group | MUST |
| R25 | Demo mode blocks creating and updating PYTHON detectors | MUST |
| R26 | REST, OpenAPI, api-client, MCP (`create_custom_detector` / `update_custom_detector` accept the PYTHON variant; `validate_detector_config` runs the contract check), docs (a "Python rules" page, SDK reference, "move a TAG rule to a Python rule" guide), i18n EN/DE | MUST |
| R27 | With [S1](S1-enterprise-extension-seams.md) present, writing code is action `detectors.manage_code`, separate from `detectors.manage` | SHOULD |

## 7. Design

### 7.1 Schema (`packages/schemas/src/schemas/all_detectors.json`)

```jsonc
"PythonPipelineSchema": {
  "type": "object",
  "properties": {
    "type": { "const": "PYTHON" },
    "notebook": { "$ref": "#/definitions/DetectorNotebook" },  // { cells: [...], revision: int }
    "packages": { "type": "array", "items": { "$ref": "#/definitions/NotebookPackage" }, "maxItems": 50 },
    "variables": { "type": "object", "additionalProperties": { "type": "string", "maxLength": 8192 }, "maxProperties": 64 },
    "secrets": { "type": "object", "additionalProperties": { "type": "string" }, "maxProperties": 64 },  // masked at rest
    "files": { "type": "array", "items": { "type": "string" }, "description": "custom_detector_files ids" },
    "fields": { "type": "array", "items": { "$ref": "#/definitions/DetectorOutputField" }, "maxItems": 50 },
    "severity": { "$ref": "#/definitions/Severity", "default": "medium", "description": "Ceiling" },
    "category": { "$ref": "#/definitions/DetectorCategory", "default": "QUALITY" },
    "deterministic": { "type": "boolean", "default": true },
    "needs_findings": { "type": "boolean", "default": false },
    "limits": { "$ref": "#/definitions/PythonDetectorLimits" },
    "scope": { "anyOf": [{ "$ref": "#/definitions/DetectorScope" }, { "type": "null" }] },
    "budget": { "anyOf": [{ "$ref": "#/definitions/DetectorBudget" }, { "type": "null" }] }
  },
  "required": ["type", "notebook"],
  "additionalProperties": false
}
```

- `DetectorOutputField` generalises `LLMOutputField` with a `date` type. [G4](G4-extracted-values-and-watch-conditions.md) uses the same definition for LLM fields.
- `single_asset_scan_results.json` → `DetectionResult` gains an optional `identity_key: string` (≤ 256 chars), contract **C1**.

### 7.2 CLI: new package `apps/cli/src/detectors/python/`

| File | Role |
|---|---|
| `sdk.py` | `DetectorAsset` (read-only: the readers from `augmentation/sdk.py::AugmentedAsset` without the writers), `Finding`, `DetectorContext(Context)` with `state` and `findings` |
| `contract.py` | `REQUIRED_FUNCTIONS = ("detect",)`, `OPTIONAL_FUNCTIONS = ("setup",)`, delegating to `notebook.contract.validate_module` |
| `runner.py` | Child entry point (mirrors `augmentation/runner.py`). Loads the module, runs `setup()` once, answers `detect` requests, requests payload through the `need` protocol |
| `session.py` | Parent-side `PythonDetectorSession`, one per (scan, detector). Owns `NotebookChildProcess` slots, installs packages, applies limits, validates output, maps it to `DetectionResult`, counts failures, disables itself after `max_consecutive_failures` |

**Shared payload server.** `AugmentationSession` already implements `_fetch_payload`, `_fetch_raw_pages`, `_fetch_text_pages` and a per-asset memo (`apps/cli/src/augmentation/session.py`). Extract these into `pipeline/asset_payload_server.py` and use it from both sessions, so one asset's payload is fetched once (R20).

**Runner factory.** `detectors/custom/runners/_factory.py` gets a `PythonRunner` whose `asset_scoped = True`. It never implements `run(text)`. The pipeline recognises asset-scoped runners, just as it already recognises TAG runners through `CustomDetector.runner`.

**Pipeline.** In `pipeline/detector_pipeline.py`, directly after the TAG pass (`_apply_asset_tags`, which runs after the content and link detectors), add `_apply_python_detectors(asset, active_detectors, prior_findings=findings, outcome_sink)`. It:
1. filters by `DetectorScope` (R15);
2. calls each session with an asset snapshot, plus `prior_findings` when `needs_findings`;
3. maps and validates the results (R9–R14);
4. records `DetectorOutcome` OK or ERROR per detector (R12, R17);
5. goes through the existing breaker (`self._breaker`).

**Cache.** `pipeline/scan_cache.py` already fingerprints detector config and drops secret-shaped keys (`_SECRET_CONFIG_KEYS`). Add the code hash, file content hashes and `PYTHON` in `detectors/engine_version.py`. Make `is_cacheable_detector_type` config-aware, so `deterministic: false` opts out (R18).

### 7.3 API

- **Validation.** `custom-detectors.service.ts` validates the JSON schema, then runs the contract check through the CLI (`notebook --mode validate` with scope `detector`), exactly as the notebook service validates CUSTOM notebooks. Any change to cells, packages, files or fields bumps `CustomDetector.version`.
- **Secrets.** They are masked at rest with `MaskedConfigCryptoService` (`encryptMaskedConfig` / `decryptMaskedConfig`) and never returned unmasked. They are decrypted at dispatch in `CliRunnerService.hydrateCustomDetectorsForRun`, the same place LLM provider credentials are injected into `provider_runtime`.
- **Files.** New `CustomDetectorFile` model (see below), endpoints `POST/GET/DELETE /custom-detectors/:id/files`, delivered to the scan job the same way source files are.
- **Identity (C1).** `utils/detection-identity.ts::generateDetectionIdentity` accepts `identityKey`. When present, the composite key is `${assetId}:${detector}:${customKey}:${findingType}:id:${identityKey}`. Existing identities are unchanged because the field is new.
- **Normalised values (C2).** The correlation value writer (`correlation/correlation.service.ts`, `value-normalizer.ts`) prefers `finding.metadata.normalized_value` for findings with `extraction_method=PYTHON`, and skips PYTHON findings without it.
- **Previews.** `NotebookExecution` gets `customDetectorId String?`, `assetId String?`, scope `DETECTOR` and mode `PREVIEW_DETECT`. `sourceId` stays required: the preview runs against that source's asset. The CLI's `NotebookScope` and `ExecutionMode` (`apps/cli/src/notebook/protocol.py`) gain the same values.
- **Test scenarios.** Add `inputAsset Json?` to `CustomDetectorTestScenario`, and extend the comparator (`custom-detector-tests.comparator`) with finding-list matching (label, identity or value, severity, count; exact or subset).

```prisma
model CustomDetectorFile {
  id               String   @id @default(uuid())
  customDetectorId String   @map("custom_detector_id")
  fileName         String   @map("file_name")
  declaredMimeType String   @map("declared_mime_type")
  fileSizeBytes    Int      @map("file_size_bytes")
  contentHash      String   @map("content_hash") @db.VarChar(64)
  data             Bytes
  createdAt        DateTime @default(now()) @map("created_at")
  customDetector   CustomDetector @relation(fields: [customDetectorId], references: [id], onDelete: Cascade)
  @@unique([customDetectorId, fileName])
  @@map("custom_detector_files")
}
```

Add `customDetectorFile` to the `customDetectors` scope in `apps/api/src/data-transfer/transfer-scopes.ts`, with the bytes. Secrets inside `pipelineSchema` are stripped by the existing credential guard.

### 7.4 Web (`apps/web`)

- **Type selector.** `components/detector-type-selector.tsx` gets "Python rule", with the explainer "checks and rules over rows, text or metadata; runs your code".
- **Editor.** New `components/python-detector-editor.tsx`, composed from the notebook components: `notebook/notebook-editor.tsx`, `code-cell.tsx`, `package-table.tsx`, and the variables and secrets pattern from `augmentation-config.tsx`. Add a files card, a fields table, and the existing scope and budget cards.
- **Preview.** Reuse the `notebook/preview-assets-dialog.tsx` pattern: pick a source, pick an asset, run, then list findings with location and fields.
- **Tests tab.** `components/custom-detector-tests.tsx` accepts asset fixtures, with a "capture from asset" button that snapshots a real asset's metadata and first N rows or pages into a fixture.

### 7.5 MCP and autopilot

- The PYTHON variant is added to the zod schemas of `create_custom_detector`, `update_custom_detector` and `validate_detector_config` in `mcp-server.factory.ts` and `mcp-tool-schemas.ts`. Writes carrying code require the `custom_source_code` group (`mcp-catalog.ts`). `mcp-catalog.completeness.spec.ts` keeps every tool grouped.
- The detector-authoring toolset refuses the PYTHON type. The escalation path can raise a notification with a proposed rule for a person to paste and review (R24).

### 7.6 Starter templates

Shipped as [G2](G2-eu-detection-coverage.md) bundles:
1. Row integrity (total equals the sum of parts)
2. List screening from an uploaded CSV
3. Composite co-occurrence rule (`needs_findings`)
4. Metadata threshold (asset metadata compared with a variable)
5. Bring-your-own scikit-learn or ONNX model

Each ships with test scenarios.

## 8. How it connects

| With | What flows |
|---|---|
| **F3** finding fields ([G4](G4-extracted-values-and-watch-conditions.md)) | `Finding.fields` travels as `extracted_data`. Until G4 ships it is stored like LLM fields (`ExtractionPayload`). G4's typed table then indexes it with no change in G1 |
| **F4** value index ([G5](G5-entities.md)) | `normalized_value` → `asset_correlation_values` → recurrence conditions and entity resolution |
| **F5** bundles ([G2](G2-eu-detection-coverage.md)) | PYTHON detectors export and import with code, fields, files (opt-in) and test scenarios. Imports arrive **inactive** |
| **F2** conditions ([G4](G4-extracted-values-and-watch-conditions.md)) | Watches can test PYTHON fields (`extracted.<key>.<field> > 20`) and labels |
| **F6** seams ([S1](S1-enterprise-extension-seams.md)) | `detectors.manage_code` action; `createdBy` from the actor context |
| [G7](G7-outcome-metrics.md) | Precision per rule from reviewer verdicts: the quality gate that keeps rules from adding noise |

## 9. Rollout and migration

- Additive schema and migrations: `custom_detector_files`, the new columns on `notebook_executions` and `custom_detector_test_scenarios`, and new enum values. No existing detection identity changes.
- **GENESIS migration guide.** Move `de_dq_*` and `de_land_alert_*` from notebooks to PYTHON detectors attached to the same sources. Keep the TAG keys until the new findings are verified, then remove the tag assertions. `cleanup_removed_detector_findings` resolves the old TAG findings.

## 10. Testing and acceptance

- **Contract:** a notebook without `detect` is rejected on save, before preview and before a scan, each with a clear error.
- **P4 regression:** a rule fires on an asset in run 1 and not in run 2. The finding is RESOLVED ("Detection no longer present in scan").
- **Identity:** the value text changes between runs but `identity` is stable, so it is the same finding, updated (history shows RE_DETECTED), not a resolve plus a new finding.
- **Containment:** an exception on one asset gives a warning and an ERROR outcome for that detector only. Other detectors' findings on that asset are unaffected. After 10 consecutive failures the session disables itself with one warning.
- **Cache:** an unchanged asset with an unchanged rule is skipped. Changing the rule's code re-runs only this detector across the corpus. `deterministic: false` is never skipped.
- **needs_findings:** the composite rule sees PII findings from the same run and not PYTHON findings from other rules.
- **Security:** secrets are absent from logs, preview output and the API response. The child environment has no `CLASSIFYRE_INTERNAL_KEY`.
- **Scale:** a 100k-row Parquet asset under AUTOMATIC sampling stays within the payload window (`pipeline/payload_window.py`), and `rows()` streams without loading everything.
- **E2E (Playwright, `apps/e2e`):** create from the row-integrity template, preview on an asset, attach to a source, run, and see a finding with a row location and fields.

## 11. Success measures

- GENESIS: at least 80 % of computed TAG detectors replaced by PYTHON detectors, with no loss of findings. P4, P6 and P9 cannot recur for migrated rules.
- Precision per PYTHON rule (G7) visible and at least 90 % for shipped templates on their test corpora.
- Community: at least five contributed PYTHON bundles in the repository's detector packs within two releases.

## 12. Open questions

- **Cross-asset rules.** Allow `finalize(ctx)` to yield findings anchored to asset ids collected in `ctx.state`? It is useful for outlier checks against the run's distribution. The cost is resolution semantics for assets not re-yielded. Proposed for v2.
- **Network egress.** Should PYTHON detectors be able to declare "no network" and have the child run without it? It is not possible today for notebooks either, so it is a platform decision.

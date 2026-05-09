# Detector Catalog Audit

Audits `packages/schemas/src/schemas/all_detectors.json` against `apps/cli/src/detectors/`.

Last updated: 2026-05-08.

---

## Snapshot

- Catalog entries: **10**, all active
- Catalog type names match runtime type names exactly
- No duplicate `detector_type` entries

---

## What Was Deleted (historical)

| Removed | What it was |
|---|---|
| `advanced_detectors.py` (581 lines) | Heuristic stubs: `HATE_SPEECH`, `AI_GENERATED`, `CONTENT_QUALITY`, `BIAS`, `DUPLICATE`, `DOMAIN_CLASS`, `CONTENT_TYPE`, `SENSITIVITY_TIER`, `JURISDICTION_TAG`, `IMAGE_VIOLENCE`, `OCR_PII`, `DEID_SCORE`, `PLAGIARISM` |
| `PHISHING_URL` + detector | `CrabInHoney/urlbert-tiny-phishing-classifier` via transformers |
| `prompt_injection_detector.py` | `protectai/deberta-v3-base-prompt-injection-v2` via transformers |
| `nsfw_detector.py` | Hardcoded NSFW detector → replaced by generic `IMAGE_CLASSIFICATION` |
| `spam_detector.py` | Heuristic-default spam detector → replaced by generic `TEXT_CLASSIFICATION` |

---

## Detector Runtime Analysis

### SECRETS

| | |
|---|---|
| File | `secrets/detector.py` |
| Library | `detect-secrets` — `SecretsCollection` + `transient_settings` |
| Config type | `SecretsDetectorConfig` |
| Model/tool | Plugin-based; no remote model |
| Regex in our code | **None** |

**Initialization:** Full. Plugin set is built dynamically from config via `transient_settings({"plugins_used": [...]})`. 26 plugin types supported, including entropy detectors with configurable limits. All pattern matching delegated to the library.

**Library utilization:** Good. `detect-secrets` also exposes `verify` per-finding and `exclude_lines_re` filter — neither is surfaced in config but both are edge-case features. Not a meaningful gap.

---

### PII

| | |
|---|---|
| File | `pii/detector.py` |
| Libraries | `presidio_analyzer` (AnalyzerEngine), `presidio_analyzer.nlp_engine` (SpacyNlpEngine + NerModelConfiguration), `spacy` (`en_core_web_sm` or configurable), `tldextract` (offline-patched), `phonenumbers` |
| Config type | `PIIDetectorConfig` |
| Regex in our code | **Yes — 3 uses, none for detection** |

**Initialization:** Full. Builds `SpacyNlpEngine` with filtered `NerModelConfiguration`, registers custom `PatternRecognizer` instances from config, patches `tldextract` to offline mode before Presidio loads (prevents network hang), probes the phone recognizer at init and removes it gracefully if `phonenumbers` regional data is missing.

**Regex detail:**
1. `_TABULAR_ROW_RE` / `_TABULAR_CELL_RE` / `_TABULAR_CONTINUATION_RE` (lines 221–223) — parse the `row_N: / col: value` text format fed to the detector; input format parsing, not entity detection
2. `re.sub(r"[^a-z0-9]+", ...)` — normalize column names to tokens for entity-hint lookup
3. `re.findall(r"[A-Za-z][A-Za-z'-]*", ...)` — count word tokens in a PERSON match to suppress single-word false positives in free-text columns

None of these drive detection. All could be replaced with `str` operations if needed but it's low priority.

**Library utilization:** Good. `presidio_anonymizer` is in the privacy dependency group but is for anonymization output, not detection — not a gap. The `batch_analyze` method on `AnalyzerEngine` exists for scanning multiple texts in one call; the tabular path currently calls Presidio per-cell (up to 200 cells), so `batch_analyze` could reduce overhead. Worth considering if per-document latency becomes a problem.

---

### TOXIC

| | |
|---|---|
| File | `content/toxic_detector.py` |
| Library | `detoxify`, `torch` |
| Config type | `ContentDetectorConfig` |
| Model | `Detoxify("original")` — hardcoded |
| Regex in our code | **None** |

**Initialization:** Full. Loads Detoxify `original` at construction, all 6 toxicity types covered (`toxicity`, `severe_toxicity`, `obscene`, `threat`, `insult`, `identity_attack`).

**Library utilization:** Partial gap. Detoxify ships three model variants:

| Variant | Coverage |
|---|---|
| `original` | English only, 6 labels, smallest |
| `unbiased` | English, reduced identity-group bias |
| `multilingual` | 7 languages (en, fr, es, it, pt, tr, ru), 6 labels |

The model is hardcoded to `"original"` with no config override. `ContentDetectorConfig` doesn't expose a `model` field. If multilingual content or bias-sensitive use cases matter, this is the main gap to close — add a `model` field (`original` | `unbiased` | `multilingual`) to `ContentDetectorConfig` and pass it to `Detoxify(...)`.

---

### IMAGE_CLASSIFICATION

| | |
|---|---|
| File | `content/image_classification_detector.py` |
| Libraries | `transformers` (pipeline `"image-classification"`), `PIL.Image`, `torch` |
| Config type | `ImageClassificationDetectorConfig` |
| Default model | `google/vit-base-patch16-224` |
| Regex in our code | **Yes — config-driven severity mapping only** |

**Initialization:** Full. All pipeline parameters wired from config: `model`, `model_revision`, `device`, `top_k`, `function_to_apply`. Any HuggingFace vision model or local path is accepted.

**Regex detail:** `re.search(rule.pattern, label_lower)` in `_resolve_severity()` matches user-supplied patterns from the `severity_map` config list against the model's predicted label. This is label → severity translation after classification — not detection logic. Keep as-is.

**Library utilization:** Good. `transformers.pipeline` also supports `batch_size` for batching multiple images in one forward pass — not exposed in config but only relevant for bulk image scanning workloads.

Replaces the old hardcoded `NSFW` detector. NSFW scanning is now achieved by setting `model: "Falconsai/nsfw_image_detection"` and defining `severity_map` rules.

---

### YARA

| | |
|---|---|
| File | `threat/yara_detector.py` |
| Library | `yara` (yara-python) |
| Config type | `ThreatDetectorConfig` |
| Regex in our code | **Yes — rule name sanitization only** |

**Initialization:** Full. Accepts structured `YaraRuleConfig` objects from `ThreatDetectorConfig.rules`, assembles them into a valid YARA source string via `_build_source()`, and compiles with `yara.compile(source=...)`.

**Regex detail:** `_SAFE_NAME = re.compile(r"[^A-Za-z0-9_]")` in `_sanitize_name()` normalizes user-provided rule names into valid YARA identifiers. Utility function, not detection.

**Design change from previous version:** Built-in preset rule libraries (`secrets`, `malware_indicators`, `suspicious_scripts`, `office_macros`, `pdf_threats`, `supply_chain`, `network_ioc`, `credential_theft`) are gone. The detector is now fully config-driven — no rules compile if `ThreatDetectorConfig.rules` is empty. All rule authoring is delegated to the caller via config.

**Library utilization:** Good. `yara.compile()` also accepts `filepaths` (dict of namespace → file path) and `filepath` (single file) — not needed given the config-driven approach.

---

### BROKEN_LINKS

| | |
|---|---|
| File | `broken_links/detector.py` |
| Library | `requests` (Session, HEAD + streaming GET fallback) |
| Config type | `BrokenLinksDetectorConfig` |
| Regex in our code | **None** |

**Initialization:** Full. `requests.Session` with custom User-Agent, async semaphore for concurrency (12 max), HEAD-first with GET fallback for `405`/`501`, redirect following, streaming GET to check non-empty body.

**Library utilization:** Good. Could switch to `aiohttp` for native async HTTP without `asyncio.to_thread` wrapping, but the current approach is correct and avoids an extra dependency.

---

### TEXT_CLASSIFICATION

| | |
|---|---|
| File | `content/text_classification_detector.py` |
| Libraries | `transformers` (pipeline `"text-classification"`), `torch` |
| Config type | `TextClassificationDetectorConfig` |
| Default model | **None — `model` is required in config** |
| Regex in our code | **Yes — config-driven severity mapping only** |

**Initialization:** Full. All pipeline parameters wired from config: `model`, `model_revision`, `device`, `top_k`, `function_to_apply`. Raises at construction if `model` is not set. Handles both single-label and multi-label pipeline output normalization.

**Regex detail:** Same `_resolve_severity()` pattern as `IMAGE_CLASSIFICATION` — user-supplied `severity_map` rules applied after model inference. Keep as-is.

**Library utilization:** Good. Same `batch_size` gap as `IMAGE_CLASSIFICATION` — minor, only relevant for high-volume text scanning.

Replaces the old `SPAM` detector. The spam heuristic (keyword matching + URL regex) is gone. Spam scanning is now `model: "mrm8488/bert-tiny-finetuned-sms-spam-detection"` in config — always model-first, no fallback.

---

### LANGUAGE

| | |
|---|---|
| File | `content/language_detector.py` |
| Library | `fast_langdetect` |
| Config type | `LanguageDetectorConfig` |
| Regex in our code | **None** |

**Initialization:** Full. Calls `fast_langdetect.detect(content, model=model, k=k)` with both the `model` and `k` (top-k candidates) parameters wired from config. Default model is `Model.auto`; `k=1` returns the single best prediction, `k>1` returns multiple language candidates as separate findings.

**Library utilization:** Good. `fast_langdetect` also has a `detect_multilingual()` function for content that mixes several languages — the current approach handles this adequately via `k > 1`.

---

### CODE_SECURITY

| | |
|---|---|
| File | `threat/code_security_detector.py` |
| Library | `bandit` (subprocess: `python -m bandit -q -f json`) |
| Config type | `CodeSecurityDetectorConfig` (or `GenericDetectorConfig`) |
| Regex in our code | **None** |

**Initialization:** Eager availability check at construction; subprocess execution to avoid stevedore plugin discovery noise at import time.

**Config wired:** `tests` (bandit `--test` flag — allowlist specific test IDs), `skips` (bandit `--skip` flag — denylist specific test IDs), `severity_threshold` (post-filter on bandit output). All three are passed through when `CodeSecurityDetectorConfig` is provided.

**Library utilization:** Mostly good. One minor gap: bandit's `--level` flag (`-l`/`-ll`/`-lll`) can filter by severity *inside the subprocess* before JSON is generated, which would be more efficient than the current Python-side `severity_threshold` filter (bandit still scans and emits everything, then we drop low-severity results). This only matters at scale.

---

### CUSTOM

| | |
|---|---|
| Files | `custom/detector.py`, `custom/runners.py`, `custom/trainer.py` |
| Libraries | `gliner2` (GLiNER2.from_pretrained), `setfit` (SetFitModel, loaded from artifact dirs), `torch` |
| Config type | `CustomDetectorConfig` |
| Default model | `fastino/gliner2-base-v1` |
| Runners | `GLiNER2Runner` (default), `RegexRunner`, `LLMRunner` (stub) |
| Regex in our code | **Yes — intentional feature** |

**Initialization:** GLiNER2Runner lazy-loads the model on first `run()` call. If a trained artifact directory is detected (`manifest.json` present), loads the fine-tuned GLiNER2 weights from `<dir>/gliner2/` and per-task SetFit models from `<dir>/setfit/<task>/`.

**Regex detail:** `RegexRunner` is a first-class pipeline type — compiles user-defined patterns from `RegexPipelineSchema.patterns` and returns span matches. Validation rules in `_apply_entity_validation()` also support regex patterns. Both are intentional and config-driven.

**Library utilization:** Good. `LLMRunner` is a stub (`raise NotImplementedError`) — the LLM pipeline path exists in the schema but has no implementation yet.

---

## Regex Summary

| Detector | Regex | Category | Action |
|---|---|---|---|
| `SECRETS` | No | — | — |
| `PII` | Yes | Input parsing + token counting; not detection | Low priority; removable |
| `TOXIC` | No | — | — |
| `IMAGE_CLASSIFICATION` | Yes | Config-driven label → severity mapping | Keep |
| `YARA` | Yes | Rule name sanitization (`[^A-Za-z0-9_]`) | Keep |
| `BROKEN_LINKS` | No | — | — |
| `TEXT_CLASSIFICATION` | Yes | Config-driven label → severity mapping | Keep |
| `LANGUAGE` | No | — | — |
| `CODE_SECURITY` | No | — | — |
| `CUSTOM` | Yes | `RegexRunner` — intentional feature | Keep |

No detector uses regex as a detection fallback.

---

## Library Utilization Gaps

| Detector | Gap | Priority |
|---|---|---|
| `TOXIC` | Model hardcoded to `"original"`. Detoxify ships `"unbiased"` (reduced identity bias) and `"multilingual"` (7 languages). No `model` field in `ContentDetectorConfig`. | Medium — add `model` field |
| `PII` | `AnalyzerEngine.batch_analyze()` could replace the per-cell loop (up to 200 Presidio calls per tabular page) for lower latency. | Low — only relevant at scale |
| `CODE_SECURITY` | Severity filtering done in Python after bandit runs. Passing `--level` to bandit would skip emitting low-severity results entirely, reducing subprocess output. | Low |
| `IMAGE_CLASSIFICATION` | `batch_size` not exposed in config — minor for bulk image workloads. | Low |
| `TEXT_CLASSIFICATION` | `batch_size` not exposed in config. | Low |
| `YARA` | Built-in preset rules removed — no out-of-the-box coverage if `rules` is empty in config. Previous version shipped 8 preset libraries. | Design decision, not a bug |
| `CUSTOM` | `LLMRunner` is a stub. | Known, tracked |

---

## Functional Overlap

### SECRETS vs YARA (when rules include secret patterns)

If `ThreatDetectorConfig.rules` contains secret-detection patterns (AWS keys, tokens, etc.), both `SECRETS` and `YARA` will fire on the same content. `SECRETS` provides line-level precision and extracted secret values; `YARA` provides multi-string condition matching. Duplicate findings on the same content are expected — callers should deduplicate on `(finding_type, matched_content)` if needed.

No other detectors share significant detection surface.

---

## Catalog Accuracy

| Field | Status |
|---|---|
| Type names | Match runtime exactly |
| `recommended_model` for `CUSTOM` | Stale — catalog says `mDeBERTa-v3 + SetFit + GLiNER`, runtime default is `fastino/gliner2-base-v1` (GLiNER2) |
| All other `recommended_model` fields | Accurate |

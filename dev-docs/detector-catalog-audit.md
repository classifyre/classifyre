# Detector Catalog Audit

Audits `packages/schemas/src/schemas/all_detectors.json` against `apps/cli/src/detectors/`.

Last updated: 2026-05-08 (post-refactor, unstaged changes included).

---

## Snapshot

- Catalog entries: **10** (down from 25)
- All 10 are **active** — no planned or experimental entries remain
- Catalog type names match runtime type names exactly
- No duplicate `detector_type` entries

---

## What Was Deleted

| Removed | What it was |
|---|---|
| `advanced_detectors.py` (581 lines) | Heuristic stubs for `HATE_SPEECH`, `AI_GENERATED`, `CONTENT_QUALITY`, `BIAS`, `DUPLICATE`, `DOMAIN_CLASS`, `CONTENT_TYPE`, `SENSITIVITY_TIER`, `JURISDICTION_TAG`, `IMAGE_VIOLENCE`, `OCR_PII`, `DEID_SCORE`, `PLAGIARISM` |
| `PHISHING_URL` + detector | ML detector using `CrabInHoney/urlbert-tiny-phishing-classifier` |
| `threat/prompt_injection_detector.py` | ML detector using `protectai/deberta-v3-base-prompt-injection-v2` |
| `content/nsfw_detector.py` | Hardcoded NSFW detector → replaced by generic `IMAGE_CLASSIFICATION` |
| `content/spam_detector.py` | Heuristic-default spam detector → replaced by generic `TEXT_CLASSIFICATION` |

---

## Detector Runtime Analysis

### SECRETS

| | |
|---|---|
| File | `secrets/detector.py` |
| Library | `detect-secrets` — `SecretsCollection` + `transient_settings` |
| Config type | `SecretsDetectorConfig` |
| Initialization | Full: plugin set built from config via `transient_settings({"plugins_used": ...})`; all detection delegated to the library |
| Regex in our code | **None** — all pattern matching done by detect-secrets plugins |

---

### PII

| | |
|---|---|
| File | `pii/detector.py` |
| Libraries | `presidio_analyzer` (AnalyzerEngine), `presidio_analyzer.nlp_engine` (SpacyNlpEngine + NerModelConfiguration), `spacy` (`en_core_web_sm` or configurable), `tldextract` (offline-patched), `phonenumbers` |
| Config type | `PIIDetectorConfig` |
| Initialization | Full: SpacyNlpEngine with filtered NER config, custom recognizers via PatternRecognizer, phone recognizer probe at init |
| Regex in our code | **Yes — 3 uses, none for entity detection:** |

1. `_TABULAR_ROW_RE` / `_TABULAR_CELL_RE` / `_TABULAR_CONTINUATION_RE` (lines 221–223) — parse the `row_N: / col: value` text format fed to the detector; this is input format parsing
2. `re.sub(r"[^a-z0-9]+", ...)` (line 449) — normalize column name to tokens for entity-hint lookup
3. `re.findall(r"[A-Za-z][A-Za-z'-]*", ...)` (line 623) — count word tokens in a PERSON match to filter single-token false positives

All three are structural utilities. None drives entity detection. Replaceable with `str.split()` / `str.isalpha()` if the goal is to eliminate `import re` entirely, but low priority.

---

### TOXIC

| | |
|---|---|
| File | `content/toxic_detector.py` |
| Library | `detoxify` (`Detoxify("original")`), `torch` |
| Config type | `ContentDetectorConfig` |
| Initialization | Full: loads Detoxify `original` at construction, covers all 6 toxicity types |
| Regex in our code | **None** |

---

### IMAGE_CLASSIFICATION

| | |
|---|---|
| File | `content/image_classification_detector.py` |
| Libraries | `transformers` (pipeline `"image-classification"`), `PIL.Image`, `torch` |
| Config type | `ImageClassificationDetectorConfig` |
| Default model | `google/vit-base-patch16-224` (configurable via `model` field) |
| Initialization | Full: builds pipeline with all config fields wired — `model`, `model_revision`, `device`, `top_k`, `function_to_apply` |
| Regex in our code | **Yes — config-driven severity mapping only:** `re.search(rule.pattern, label_lower)` in `_resolve_severity()` matches user-supplied patterns from `severity_map` config to predicted label strings. This is not detection; it is label → severity translation after the model has already classified the image. **Keep as-is.** |

Replaces the old hardcoded `NSFW` detector. Any vision model can now be wired in via config; NSFW scanning is achieved by pointing `model` at `Falconsai/nsfw_image_detection` and defining appropriate `severity_map` rules.

---

### YARA

| | |
|---|---|
| File | `threat/yara_detector.py` |
| Library | `yara` (yara-python) |
| Config type | `ThreatDetectorConfig` |
| Initialization | Full: compiles all active preset rule sources into a single `yara.compile(sources={...})` object |
| Presets | `secrets`, `malware_indicators`, `suspicious_scripts`, `office_macros`, `pdf_threats`, `supply_chain`, `network_ioc`, `credential_theft` |
| Regex in our code | **None in Python** — YARA rule strings contain regex as YARA syntax, which is intentional |

---

### BROKEN_LINKS

| | |
|---|---|
| File | `broken_links/detector.py` |
| Library | `requests` (Session with HEAD + streaming GET fallback) |
| Config type | `BrokenLinksDetectorConfig` |
| Initialization | Full: `requests.Session` with custom User-Agent, async semaphore, redirect following |
| Regex in our code | **None** |

---

### TEXT_CLASSIFICATION

| | |
|---|---|
| File | `content/text_classification_detector.py` |
| Library | `transformers` (pipeline `"text-classification"`), `torch` |
| Config type | `TextClassificationDetectorConfig` |
| Default model | **None** — `model` is required in config; raises at construction if unset |
| Initialization | Full: builds pipeline with `model`, `model_revision`, `device`, `top_k`, `function_to_apply`. No heuristic fallback. |
| Regex in our code | **Yes — config-driven severity mapping only:** same `_resolve_severity()` pattern as `IMAGE_CLASSIFICATION`. User-supplied `severity_map` rules applied after model inference. **Keep as-is.** |

Replaces the old `SPAM` detector. The spam heuristic (keyword matching + exclamation counting + URL regex) is **gone**. Any text classification model can be pointed at this detector via config; spam scanning uses `mrm8488/bert-tiny-finetuned-sms-spam-detection` by setting `model` in config — always model-first, no fallback.

---

### LANGUAGE

| | |
|---|---|
| File | `content/language_detector.py` |
| Library | `fast_langdetect` |
| Config type | `GenericDetectorConfig` |
| Initialization | Full: module imported at construction, `fast_langdetect.detect(content)` called directly |
| Regex in our code | **None** |

---

### CODE_SECURITY

| | |
|---|---|
| File | `threat/code_security_detector.py` |
| Library | `bandit` (subprocess: `python -m bandit -q -f json`) |
| Config type | `DetectorConfig` |
| Initialization | Eager availability check at construction; subprocess execution avoids stevedore plugin noise |
| Regex in our code | **None** |

---

### CUSTOM

| | |
|---|---|
| Files | `custom/detector.py`, `custom/runners.py`, `custom/trainer.py` |
| Libraries | `gliner2` (GLiNER2.from_pretrained), `setfit` (SetFitModel for trained artifact dirs), `torch` |
| Config type | `CustomDetectorConfig` |
| Default model | `fastino/gliner2-base-v1` |
| Runners | `GLiNER2Runner` (default), `RegexRunner`, `LLMRunner` (stub) |
| Initialization | GLiNER2Runner: lazy model load on first `run()` call; SetFit models loaded per-task from artifact dirs |
| Regex in our code | **Yes — intentional, it is the feature:** `RegexRunner` compiles user-defined patterns from config and is a first-class pipeline type. Validation rules also support regex. No change needed. |

---

## Regex Summary

| Detector | Regex present | Category | Action |
|---|---|---|---|
| `SECRETS` | No | — | — |
| `PII` | Yes | Input format parsing + token counting; not detection | Low priority; removable with minor refactor |
| `TOXIC` | No | — | — |
| `IMAGE_CLASSIFICATION` | Yes | Config-driven label → severity mapping | Keep |
| `YARA` | YARA syntax only | Part of YARA rule language | Keep |
| `BROKEN_LINKS` | No | — | — |
| `TEXT_CLASSIFICATION` | Yes | Config-driven label → severity mapping | Keep |
| `LANGUAGE` | No | — | — |
| `CODE_SECURITY` | No | — | — |
| `CUSTOM` | Yes | `RegexRunner` — intentional feature | Keep |

No detector uses regex as a detection fallback. The old spam heuristic (the main offender) was removed with `spam_detector.py`.

---

## Functional Overlap

### SECRETS vs YARA[secrets]

The only meaningful detection overlap. Both fire on the same secret classes:

| Pattern | SECRETS | YARA[secrets] |
|---|---|---|
| AWS Access Key | `AWSKeyDetector` | `Secrets_AWS_Access_Key` |
| GitHub token | `GitHubTokenDetector` | `Secrets_GitHub_Token` |
| GitLab token | `GitLabTokenDetector` | `Secrets_GitLab_Token` |
| Slack token | `SlackDetector` | `Secrets_Slack_Token` |
| OpenAI key | `OpenAIDetector` | `Secrets_OpenAI_Key` |
| Stripe live key | `StripeDetector` | `Secrets_Stripe_Live_Key` |
| PEM private key | `PrivateKeyDetector` | `Secrets_PEM_Private_Key` |
| JWT | `JwtTokenDetector` | `Secrets_JWT_Token` |
| Generic credential assignment | `KeywordDetector` | `Secrets_Generic_Credential_Assignment` |

Running both is intentional and worthwhile: `SECRETS` provides line-level precision and extracted secret values; `YARA` provides multi-string condition matching and covers non-secret threat categories in the same pass. The overlap produces duplicate findings for the same content — callers should deduplicate on `(finding_type, matched_content)` if needed.

No other detectors share significant detection surface.

---

## Bottom Line

- Catalog is accurate: 10 active detectors, all backed by real library implementations, type names match runtime.
- No heuristic-only stubs remain.
- No detection fallback regex anywhere — the old spam heuristic is gone.
- `NSFW` and `SPAM` are now generic pipelines (`IMAGE_CLASSIFICATION` / `TEXT_CLASSIFICATION`) — any compatible HuggingFace model can be substituted via config.
- `CUSTOM`'s `recommended_model` field in the catalog (`mDeBERTa-v3 + SetFit + GLiNER`) is outdated — runtime now uses `fastino/gliner2-base-v1` (GLiNER2) as the default, with SetFit only loaded from trained artifact directories.

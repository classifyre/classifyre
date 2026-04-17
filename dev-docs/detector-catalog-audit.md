# Detector Catalog Audit

This note audits `packages/schemas/src/schemas/all_detectors.json` and cross-checks it against the CLI runtime under `apps/cli/src/detectors/` plus detector dependency groups in `apps/cli/pyproject.toml`.

## Snapshot

- Catalog entries: `25`
- Lifecycle split: `13 active`, `11 planned`, `1 experimental`
- Duplicate `detector_type` entries: none
- Exact duplicate `recommended_model` strings: one
  - `typeform/distilbert-base-uncased-mnli` is reused by `DOMAIN_CLASS`, `CONTENT_TYPE`, and `SENSITIVITY_TIER`
- Shared model or library components inside composite recommendations:
  - `presidio-analyzer`: `PII`, `OCR_PII`, `DEID_SCORE`
  - `fast-langdetect`: `LANGUAGE`, `JURISDICTION_TAG`
- Intentionally unset recommendation:
  - `IMAGE_VIOLENCE` has `recommended_model: null` and is marked `experimental`

## What The Catalog Is Actually Storing

`all_detectors.json` is a capability catalog plus schema bundle. The detector list lives in `definitions.DetectorCatalog.default`. The `recommended_model` field is metadata, not a guaranteed 1:1 runtime download source.

That matters in a few places:

- `NSFW` says `nudenet` in the catalog, but the runtime currently uses `Falconsai/nsfw_image_detection` and falls back to `google/vit-base-patch16-224`
- `CUSTOM` says `mDeBERTa-v3 + SetFit + GLiNER` in the catalog, but the runtime pins specific defaults:
  - zero-shot: `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`
  - SetFit: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
  - entity extraction: `urchade/gliner_multi-v2.1`
- `SPAM` points at a transformer model in the catalog, but the runtime defaults to a heuristic path unless `CLASSIFYRE_ENABLE_SPAM_MODEL` is enabled
- Several planned detectors already have lightweight heuristic implementations in `apps/cli/src/detectors/advanced_detectors.py`, even when the catalog recommends a future ML stack

## Detector-Facing Libraries

These are the main detector-facing libraries referenced either directly in `all_detectors.json` or in the CLI dependency groups:

| Library or tool | Where it shows up |
|---|---|
| `detect-secrets` | `SECRETS` |
| `presidio-analyzer` | `PII`, `OCR_PII`, `DEID_SCORE` |
| `presidio-anonymizer` | privacy dependency group; paired with Presidio stack |
| `spaCy` + `en_core_web_sm` | `PII` runtime |
| `pytesseract` / Tesseract | `OCR_PII` |
| `scrubadub` | `DEID_SCORE` |
| `pycanon` | `DEID_SCORE` |
| `detoxify` | `TOXIC` |
| `nudenet` | `NSFW` catalog recommendation only |
| `transformers` | `PROMPT_INJECTION`, `PHISHING_URL`, optional `SPAM`, `NSFW`, `CUSTOM`, and likely future classifier-style detectors |
| `yara-python` | `YARA` |
| `bandit` | `CODE_SECURITY` |
| `fast-langdetect` | `LANGUAGE`, `JURISDICTION_TAG` |
| `datasketch` | `PLAGIARISM`, `DUPLICATE` |
| `sentence-transformers` | `PLAGIARISM`, `CONTENT_QUALITY`, `CUSTOM` SetFit base |
| `textstat` | `CONTENT_QUALITY` |
| `setfit` | `CUSTOM` |
| `gliner` | `CUSTOM` |
| `datasets` + `scikit-learn` | `CUSTOM` training path |
| `requests` / HTTP checks | `BROKEN_LINKS` style runtime implied by `HTTP validation engine` |
| `rules engine` | `JURISDICTION_TAG` |

## Concrete Runtime Pulls Verified In Code

The following model IDs or runtime assets are pinned in code today:

| Detector | Concrete runtime pull or asset | Notes |
|---|---|---|
| `PII` | `en_core_web_sm` | Loaded through Presidio + spaCy |
| `TOXIC` | `Detoxify("original")` | Underlying weights are managed by Detoxify |
| `NSFW` | `Falconsai/nsfw_image_detection` | Fallback: `google/vit-base-patch16-224` |
| `PROMPT_INJECTION` | `protectai/deberta-v3-base-prompt-injection-v2` | Matches catalog |
| `PHISHING_URL` | `CrabInHoney/urlbert-tiny-phishing-classifier` | Matches catalog |
| `SPAM` | `mrm8488/bert-tiny-finetuned-sms-spam-detection` | Only if `CLASSIFYRE_ENABLE_SPAM_MODEL` is enabled |
| `CUSTOM` zero-shot | `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli` | Generic `mDeBERTa-v3` catalog entry resolves to this |
| `CUSTOM` SetFit | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Used for trained custom classifiers |
| `CUSTOM` GLiNER | `urchade/gliner_multi-v2.1` | Used for entity extraction and extraction overlays |

For many of the remaining detectors, the runtime exists today as a heuristic implementation rather than a concrete remote model pull.

## Detector Matrix

| Detector | Status | Catalog `recommended_model` | Current read |
|---|---|---|---|
| `SECRETS` | `active` | `detect-secrets` | Package/tool recommendation; no separate model pull |
| `PII` | `active` | `presidio-analyzer` | Runtime uses Presidio plus spaCy `en_core_web_sm` |
| `TOXIC` | `active` | `detoxify` | Runtime loads Detoxify `original` |
| `NSFW` | `active` | `nudenet` | Catalog/runtime mismatch; runtime uses `Falconsai/nsfw_image_detection` |
| `YARA` | `active` | `yara-python` | Rule engine / package, not a remote model |
| `BROKEN_LINKS` | `active` | `HTTP validation engine` | Engine description, not a library package name |
| `PROMPT_INJECTION` | `active` | `protectai/deberta-v3-base-prompt-injection-v2` | Exact runtime model found |
| `PHISHING_URL` | `active` | `CrabInHoney/urlbert-tiny-phishing-classifier` | Exact runtime model found |
| `SPAM` | `active` | `mrm8488/bert-tiny-finetuned-sms-spam-detection` | Exact runtime model exists, but heuristic mode is default |
| `LANGUAGE` | `active` | `fast-langdetect` | Package-based detector, no remote model ID |
| `CODE_SECURITY` | `active` | `bandit` | Subprocess tool execution, no remote model |
| `PLAGIARISM` | `planned` | `datasketch + all-MiniLM-L6-v2` | Runtime currently uses a heuristic repeated-segment detector |
| `IMAGE_VIOLENCE` | `experimental` | `null` | Catalog intentionally leaves ML unset; runtime currently falls back to heuristic keyword matching |
| `OCR_PII` | `planned` | `tesseract + presidio-analyzer` | Runtime currently uses regex-style OCR text heuristics, not Tesseract |
| `DEID_SCORE` | `planned` | `presidio-analyzer + pycanon + scrubadub` | Runtime currently computes a heuristic residual-PII score |
| `HATE_SPEECH` | `planned` | `facebook/roberta-hate-speech-dynabench-r4-target` | Runtime currently uses keyword heuristics |
| `AI_GENERATED` | `planned` | `distilbert-base-uncased (RAID fine-tuned)` | Runtime currently uses phrase heuristics |
| `CONTENT_QUALITY` | `planned` | `sentence-transformers/all-MiniLM-L6-v2 + textstat` | Runtime currently uses heuristic readability-style scoring |
| `BIAS` | `active` | `valurank/distilroberta-bias` | Runtime exists in `advanced_detectors.py` as keyword heuristics, not the catalog model |
| `DUPLICATE` | `planned` | `datasketch (MinHash LSH)` | Runtime currently uses repeated-line heuristics |
| `DOMAIN_CLASS` | `planned` | `typeform/distilbert-base-uncased-mnli` | Runtime currently uses keyword heuristics; catalog model string is reused across three detectors |
| `CONTENT_TYPE` | `planned` | `typeform/distilbert-base-uncased-mnli` | Runtime currently uses keyword heuristics; catalog model string is reused across three detectors |
| `SENSITIVITY_TIER` | `planned` | `typeform/distilbert-base-uncased-mnli` | Runtime currently uses rules/keywords; catalog model string is reused across three detectors |
| `JURISDICTION_TAG` | `planned` | `fast-langdetect + rules engine` | Runtime currently uses keyword heuristics; shares `fast-langdetect` family with `LANGUAGE` |
| `CUSTOM` | `active` | `mDeBERTa-v3 + SetFit + GLiNER` | Runtime pins concrete defaults for all three parts |

## Bottom Line

- There are no duplicate detector catalog entries.
- There is one exact duplicate `recommended_model` recommendation reused across three classification detectors.
- Several detectors share library families even when the full recommendation string differs, especially the Presidio stack and `fast-langdetect`.
- The catalog is directionally accurate, but it is not always the exact runtime truth.
- A large part of the gap is that the catalog describes target ML stacks while the runtime still uses heuristic implementations for several planned detectors.
- The clearest catalog/runtime mismatches today are `NSFW`, `CUSTOM`, `SPAM`, and the advanced heuristic detectors under `advanced_detectors.py`.

# Finding Metadata Reference

Documents the `metadata` JSONB field on the `Finding` model — what each detector produces, how it flows through the system, and how to query it.

Last updated: 2026-05-09.

---

## Overview

Every detector attaches a `metadata` dict to each `DetectionResult`. This dict carries detector-specific context that goes beyond the core finding fields (`matched_content`, `severity`, `confidence`, `location`).

**Data flow:**

```
CLI Detector → DetectionResult.metadata
  → Bulk Ingest API (POST /sources/:id/assets/bulk)
    → Finding.metadata (JSONB column, GIN-indexed)
      → GET /findings/:id  →  FindingResponseDto.metadata
        → FindingMetadataCard (frontend)
```

**Storage rules:**

- The `embedding` key (produced by `FEATURE_EXTRACTION`) is stripped before persistence — embedding vectors are too large for a metadata column (~6 KB per 768-dim vector). The remaining keys (`dimension`, `model`, `pooling_strategy`, `normalized`) are preserved.
- All other metadata keys are stored as-is.
- The column is nullable. Findings created before this feature was added have `metadata = NULL`.

---

## Metadata by Detector

### SECRETS

| Key | Type | Description |
|---|---|---|
| `detector` | `string` | Always `"secrets"` |
| `plugin` | `string` | The `detect-secrets` plugin class that matched (e.g. `AWSKeyDetector`, `GitHubTokenDetector`, `JwtTokenDetector`) |
| `is_verified` | `boolean` | Whether the secret was verified against its service |

**Source file:** `apps/cli/src/detectors/secrets/detector.py`

---

### PII

| Key | Type | Description |
|---|---|---|
| `recognizer` | `string` | Presidio recognizer name that produced the match (e.g. `SpacyRecognizer`, `UsPhoneRecognizer`) |
| `entity_type` | `string` | Presidio entity type (e.g. `US_SSN`, `EMAIL_ADDRESS`, `CREDIT_CARD`, `PERSON`) |
| `tabular_row_index` | `integer` | Row index within the tabular page (only for tabular content) |
| `tabular_column_name` | `string` | Column name where the value was found (only for tabular content) |

**Source file:** `apps/cli/src/detectors/pii/detector.py`

---

### IMAGE_CLASSIFICATION

| Key | Type | Description |
|---|---|---|
| `image_size` | `string` | Image dimensions as `"WxH"` (e.g. `"1920x1080"`) |
| `image_mode` | `string` | PIL image mode (`RGB`, `RGBA`, `L`, etc.) |
| `model` | `string` | HuggingFace model ID (e.g. `google/vit-base-patch16-224`) |

**Source file:** `apps/cli/src/detectors/content/image_classification_detector.py`

---

### OBJECT_DETECTION

| Key | Type | Description |
|---|---|---|
| `box` | `object` | Bounding box: `{ xmin, ymin, xmax, ymax }` (pixel coordinates) |
| `score` | `number` | Raw model confidence for this detection |
| `image_size` | `string` | Image dimensions as `"WxH"` |
| `model` | `string` | HuggingFace model ID (e.g. `facebook/detr-resnet-50`) |

**Source file:** `apps/cli/src/detectors/content/object_detection_detector.py`

---

### TEXT_CLASSIFICATION

| Key | Type | Description |
|---|---|---|
| `model` | `string` | HuggingFace model ID (e.g. `mrm8488/bert-tiny-finetuned-sms-spam-detection`) |
| `predicted_label` | `string` | The classification label from the model |
| `score` | `number` | Model prediction confidence |

**Source file:** `apps/cli/src/detectors/content/text_classification_detector.py`

---

### FEATURE_EXTRACTION

| Key | Type | Description |
|---|---|---|
| `embedding` | `float[]` | Dense vector (stripped before DB persistence) |
| `dimension` | `integer` | Vector dimensionality (e.g. `768`, `384`) |
| `pooling_strategy` | `string` | One of: `mean`, `cls`, `max`, `none` |
| `normalized` | `boolean` | Whether L2 normalization was applied |
| `model` | `string` | HuggingFace model ID (e.g. `BAAI/bge-base-en-v1.5`) |

> **Note:** The `embedding` key is stripped during ingestion. Only `dimension`, `pooling_strategy`, `normalized`, and `model` are persisted to the database.

**Source file:** `apps/cli/src/detectors/content/feature_extraction_detector.py`

---

### CODE_SECURITY

| Key | Type | Description |
|---|---|---|
| `tool` | `string` | Always `"bandit"` |
| `issue_text` | `string` | Human-readable description of the security issue |
| `test_name` | `string` | Bandit test name (e.g. `blacklist`, `hardcoded_password_string`) |
| `test_id` | `string` | Bandit test ID (e.g. `B105`, `B301`, `B602`) |
| `issue_severity` | `string` | Bandit's own severity level (`LOW`, `MEDIUM`, `HIGH`) |
| `issue_confidence` | `string` | Bandit's own confidence level (`LOW`, `MEDIUM`, `HIGH`) |

**Source file:** `apps/cli/src/detectors/threat/code_security_detector.py`

---

### YARA

| Key | Type | Description |
|---|---|---|
| `rule` | `string` | YARA rule name that matched |
| `description` | `string` | Rule description from config |
| `match_count` | `integer` | Number of pattern matches within the content |
| `tags` | `string[]` | YARA rule tags |

**Source file:** `apps/cli/src/detectors/threat/yara_detector.py`

---

### BROKEN_LINKS

| Key | Type | Description |
|---|---|---|
| `status_code` | `integer` | HTTP response status code (e.g. `404`, `500`). Absent for connection errors. |
| `reason` | `string` | Failure reason: `http_error`, `empty_head_content_length`, `empty_body`, `request_exception` |
| `error` | `string` | Exception message (only for `request_exception` reason, stripped by frontend OMIT_KEYS) |

**Source file:** `apps/cli/src/detectors/broken_links/detector.py`

---

### CUSTOM

Metadata varies by runner type:

**Entity extraction (GLiNER2 / Regex runner):**

| Key | Type | Description |
|---|---|---|
| `runner` | `string` | Runner type: `GLINER2`, `REGEX`, `CLASSIFIER_GLINER` |
| `entity_label` | `string` | Extracted entity label |
| `pipeline_result` | `object` | Full pipeline result (entities + classification) |

**Classification (SetFit runner):**

| Key | Type | Description |
|---|---|---|
| `runner` | `string` | Runner type (same as above) |
| `task` | `string` | Classification task name |
| `label` | `string` | Classification label |
| `pipeline_result` | `object` | Full pipeline result |

**Source file:** `apps/cli/src/detectors/custom/detector.py`

---

## Querying Metadata

The `metadata` column has a GIN index (`findings_metadata_idx`), enabling PostgreSQL JSONB containment queries.

**Examples (raw SQL):**

```sql
-- Find all PII findings where entity_type is US_SSN
SELECT * FROM findings
WHERE metadata @> '{"entity_type": "US_SSN"}';

-- Find all secrets found by a specific plugin
SELECT * FROM findings
WHERE metadata @> '{"plugin": "AWSKeyDetector"}';

-- Find all toxic findings of a specific type
SELECT * FROM findings
WHERE metadata @> '{"toxicity_type": "threat"}';

-- Find all code security findings by bandit test ID
SELECT * FROM findings
WHERE metadata @> '{"test_id": "B602"}';

-- Find all findings from a specific model
SELECT * FROM findings
WHERE metadata @> '{"model": "BAAI/bge-base-en-v1.5"}';
```

**Via Prisma (when supported):**

```typescript
// Prisma's Json filter with path-based filtering
const findings = await prisma.finding.findMany({
  where: {
    metadata: {
      path: ['entity_type'],
      equals: 'US_SSN',
    },
  },
});
```

---

## Frontend Display

The `FindingMetadataCard` component (`apps/web/components/finding-metadata-card.tsx`) renders metadata as a key-value table on the finding detail page.

**Behavior:**

- Only renders for detectors listed in `DETECTORS_WITH_USEFUL_METADATA` (PII, SECRETS, CODE_SECURITY, YARA, BROKEN_LINKS, TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, OBJECT_DETECTION)
- Omits internal keys via `OMIT_KEYS`: `scores`, `raw`, `error`, `embedding`
- Maps snake_case metadata keys to i18n translation keys for display labels
- Unknown keys are displayed as-is with title-cased labels

---

## Schema & Migration

| Layer | File | Field |
|---|---|---|
| JSON Schema | `packages/schemas/src/schemas/single_asset_scan_results.json` | `DetectionResult.metadata` — `object \| null` |
| Python Model | `apps/cli/src/models/generated_single_asset_scan_results.py` | `metadata: dict[str, Any] \| None` |
| Prisma Schema | `apps/api/prisma/schema.prisma` | `metadata Json? @db.JsonB` |
| Migration | `apps/api/prisma/migrations/20260509000000_add_finding_metadata/migration.sql` | `ALTER TABLE "findings" ADD COLUMN "metadata" JSONB` + GIN index |
| API DTO | `apps/api/src/dto/finding-response.dto.ts` | `metadata?: Record<string, unknown>` |
| API Client | `packages/api-client/src/generated/` | Auto-generated from OpenAPI spec |

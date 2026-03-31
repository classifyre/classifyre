# Beetle Test Scenarios — Extractor Tests

Test scenarios and automated tests for the **custom detector extractor** feature.
Extractors are sub-configurations inside a custom detector (`config.extractor`) that extract
structured fields from matched content, storing them as `CustomDetectorExtraction` records.

---

## What Are Extractors?

Each custom detector can have an optional `config.extractor` block:

```json
{
  "extractor": {
    "enabled": true,
    "fields": [
      {
        "id": "dish",
        "name": "dish",
        "type": "list[string]",
        "description": "Dish names"
      },
      { "id": "cuisine", "name": "cuisine", "type": "string" }
    ],
    "gliner_model": "urchade/gliner_multi-v2.1",
    "content_limit": 4000
  }
}
```

When a detector fires (creates a finding), the extractor runs and populates a
`CustomDetectorExtraction` record linked 1-to-1 with that finding.

---

## Where Extractors Are Currently Displayed in the UI

| Location          | Component                          | Display                                                                |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `/detectors/[id]` | `CustomDetectorExtractionCoverage` | Per-field population rates (shown only when `config.extractor` exists) |
| `/findings/[id]`  | `FindingExtractionCard`            | Extracted key-value fields for a single finding                        |

---

## UI Gaps — Where Extractors Are NOT Yet Displayed

These are identified gaps worth addressing:

| Location              | Current State                 | Suggested Addition                                                            |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `/detectors` list     | No extractor info             | Badge showing "Extractor: N fields" when configured                           |
| `/findings` list      | No extraction preview         | Small "extracted" badge or field count chip on rows that have extractions     |
| Asset detail page     | No extraction data            | Section showing all extractions from this asset's findings                    |
| No dedicated page     | —                             | `/detectors/[id]/extractions` table showing all extractions with field values |
| MCP `search_findings` | No extraction data in results | Include `extractionFieldCount` in finding summaries                           |

---

## Scenarios

See `scenarios/` directory for detailed test cases.

| #   | Scenario                                             | Type             |
| --- | ---------------------------------------------------- | ---------------- |
| 01  | Extractor fields displayed on finding detail         | UI / integration |
| 02  | Empty state when extractor ran but found nothing     | UI               |
| 03  | No extraction card when extractor not configured     | UI               |
| 04  | Extraction coverage on detector page                 | UI / integration |
| 05  | Coverage empty state when no extractions yet         | UI               |
| 06  | Extractor disabled — no card shown                   | UI               |
| 07  | Field types: string, list, number, boolean rendering | UI               |
| 08  | Search extractions by populated field                | API              |
| 09  | Coverage rates computed correctly                    | API / unit       |
| 10  | Findings list extraction badge (GAP scenario)        | UI gap           |
| 11  | Detector list extractor badge (GAP scenario)         | UI gap           |

---

## Test Files

```
tests/
  frontend/
    finding-extraction-card.spec.tsx       # Playwright CT — FindingExtractionCard
    extractor-editor-section.spec.tsx      # Playwright CT — extractor fields in editor
  backend/
    extractor-controller.spec.ts           # Jest — extraction API endpoints
    extractor-coverage-edge-cases.spec.ts  # Jest — coverage calculation edge cases
```

# Scenario 04 — Extraction Coverage on Detector Detail Page

## Summary

When a detector has `config.extractor` configured, the detector detail page
(`/detectors/[id]`) shows an "Extraction Coverage" section with per-field stats.

## Preconditions

- A custom detector exists with `config.extractor.enabled = true` and 2+ fields.
- At least one `CustomDetectorExtraction` record exists for this detector.

## Steps

1. Navigate to `/detectors/{detectorId}`.
2. Scroll past the editor to the "Extraction" section.

## Expected Results

| Check                                                 | Expected                 |
| ----------------------------------------------------- | ------------------------ |
| "Extraction" section heading visible                  | ✅ `<h2>Extraction</h2>` |
| `CustomDetectorExtractionCoverage` card rendered      | ✅                       |
| Total extractions badge visible                       | ✅ e.g. "3 extractions"  |
| Each field listed with populated/total and percentage | ✅                       |
| Fields with ≥80% coverage get "default" badge (dark)  | ✅                       |
| Fields with 40–79% coverage get "secondary" badge     | ✅                       |
| Fields with <40% coverage get "outline" badge         | ✅                       |
| Progress bar fills to correct percentage              | ✅                       |

## Test Data

Coverage API response:

```json
{
  "customDetectorId": "det-abc",
  "customDetectorKey": "food_discussion",
  "totalFindings": 50,
  "findingsWithExtraction": 10,
  "coverageRate": 0.2,
  "fieldCoverage": [
    { "field": "dish", "populated": 9, "total": 10, "rate": 0.9 },
    { "field": "cuisine", "populated": 5, "total": 10, "rate": 0.5 },
    { "field": "rating", "populated": 2, "total": 10, "rate": 0.2 }
  ]
}
```

Expected badge variants: `dish` → default, `cuisine` → secondary, `rating` → outline.

## Notes

- The "Extraction" section is **conditionally rendered** — it only appears when
  `Boolean(detector.config.extractor)` is truthy (`/detectors/[id]/page.tsx` line 205).
- If `config.extractor` is absent or `null`, the section is hidden entirely.

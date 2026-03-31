# Scenario 05 — Coverage Empty State When No Extractions Yet

## Summary

When a detector has `config.extractor` but no extractions have been produced yet
(no scans run since configuring it), the coverage card shows a friendly empty state.

## Preconditions

- A custom detector exists with `config.extractor.enabled = true`.
- No `CustomDetectorExtraction` records exist for this detector.

## Steps

1. Navigate to `/detectors/{detectorId}`.
2. Observe the "Extraction Coverage" card.

## Expected Results

| Check                              | Expected                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| "Extraction Coverage" card visible | ✅                                                                                  |
| Empty state icon (Layers) shown    | ✅                                                                                  |
| Message "No extraction data yet"   | ✅                                                                                  |
| Sub-message about scans            | ✅ "Extractions are generated during source scans once an extractor is configured." |
| No progress bars                   | ✅ no bars                                                                          |
| No field rows                      | ✅ no rows                                                                          |

## API Response That Triggers This State

```json
{
  "customDetectorId": "det-abc",
  "customDetectorKey": "food_discussion",
  "totalFindings": 0,
  "findingsWithExtraction": 0,
  "coverageRate": 0,
  "fieldCoverage": []
}
```

OR a 404/error from the coverage endpoint → component sets `coverage = null`
→ `normalizeCoverage(null)` returns `{ fields: [], totalExtractions: 0 }`.

# Scenario 09 — Coverage Rates Computed Correctly

## Summary

The coverage endpoint `GET /custom-detectors/{id}/extractions/coverage` must
correctly aggregate per-field population counts and compute rates.

## Formula

```
rate = populated_count / total_extractions_for_detector
```

## Test Case: 3 extractions, 3 fields

### Input

```
Extraction 1: populatedFields = ["dish", "cuisine"]
Extraction 2: populatedFields = ["dish"]
Extraction 3: populatedFields = ["dish", "cuisine", "rating"]
```

### Expected Output

```json
{
  "totalFindings": 100,
  "findingsWithExtraction": 3,
  "coverageRate": 0.03,
  "fieldCoverage": [
    { "field": "dish", "populated": 3, "total": 3, "rate": 1.0 },
    { "field": "cuisine", "populated": 2, "total": 3, "rate": 0.67 },
    { "field": "rating", "populated": 1, "total": 3, "rate": 0.33 }
  ]
}
```

## Edge Cases

### EC-09-1: No extractions at all

`fieldCoverage = []`, `findingsWithExtraction = 0`, `coverageRate = 0`.

### EC-09-2: All fields populated on every extraction

All rates = 1.0, all badges "default" (green).

### EC-09-3: Only one field ever populated across many extractions

One field rate = 1.0, others = 0.0 or absent.

### EC-09-4: Unknown detector ID

API returns `404 Not Found`.

### EC-09-5: `totalFindings = 0` edge case

`coverageRate` calculation avoids divide-by-zero → returns `0`.

## Notes

Coverage rate is `findingsWithExtraction / totalFindings` (i.e., percentage of
ALL findings from this detector that have an extraction). This is different from
individual field rates which are `populated / findingsWithExtraction`.

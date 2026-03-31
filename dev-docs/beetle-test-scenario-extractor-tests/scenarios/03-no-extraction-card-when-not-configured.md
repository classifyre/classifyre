# Scenario 03 — No Extraction Card When Extractor Not Configured

## Summary

When a finding has no associated extraction (detector has no `config.extractor`),
the finding detail page must not show any extraction card or error state.

## Preconditions

- A finding exists from a detector that has NO `config.extractor` field.
- No `CustomDetectorExtraction` record exists for this finding.

## Steps

1. Navigate to `/findings/{findingId}`.
2. Observe the page layout.

## Expected Results

| Check                            | Expected                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| No "Extracted Data" card visible | ✅ absent                                                      |
| No loading spinner stuck         | ✅ page fully loaded                                           |
| No error toast                   | ✅ no error                                                    |
| API returns 404 for extraction   | → component catches and sets state to `null` → renders nothing |

## API Behavior

`GET /findings/{findingId}/extraction` returns `404 Not Found` when no extraction record exists.
The `FindingExtractionCard` wraps this in a try/catch and sets `extraction = null` → renders `null`.

## Test Data

Use any of the existing detectors that have no `extractor` config (all current detectors
in the system: `food_discussion`, `car_rental`, `china_chinese_products`, etc.).

# Scenario 01 — Extractor Fields Displayed on Finding Detail

## Summary

When a finding has an associated extraction, the finding detail page (`/findings/[id]`)
must display the extracted structured fields in a dedicated card.

## Preconditions

- A custom detector exists with `config.extractor.enabled = true` and at least one field defined.
- A finding exists that was produced by that detector.
- A `CustomDetectorExtraction` record exists linked to that finding with `extractedData` populated.

## Steps

1. Navigate to `/findings/{findingId}`.
2. Scroll to the "Extracted Data" card.

## Expected Results

| Check                                                     | Expected                                                  |
| --------------------------------------------------------- | --------------------------------------------------------- |
| "Extracted Data" card is visible                          | ✅ visible                                                |
| Extraction method badge shown                             | ✅ shows one of: "Regex", "GLiNER", "Classifier + GLiNER" |
| Each populated field rendered as `field_name → value` row | ✅ one row per populated field                            |
| Fields with `null` / `undefined` / `""` values are hidden | ✅ not rendered                                           |
| Array values rendered as comma-joined string              | ✅ e.g. `"pasta, pizza"`                                  |

## Test Data

```json
{
  "extractedData": {
    "dish": ["pasta carbonara", "tiramisu"],
    "cuisine": "Italian",
    "price_range": null,
    "rating": ""
  },
  "extractionMethod": "CLASSIFIER_GLINER"
}
```

Expected rendered fields: `dish` and `cuisine` only.
Expected badge text: `"Classifier + GLiNER"`.
Expected `dish` value: `"pasta carbonara, tiramisu"`.

## Failure Modes

- Card not rendered at all → `getFindingExtraction` API call failed or returned 404.
- All fields hidden → entries filter is too aggressive.
- Badge missing → `extractionMethod` not in the `EXTRACTION_METHOD_LABELS` map.

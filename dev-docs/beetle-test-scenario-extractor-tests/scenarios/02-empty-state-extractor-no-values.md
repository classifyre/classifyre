# Scenario 02 — Empty State When Extractor Ran But Found Nothing

## Summary

When an extraction record exists but `extractedData` has no non-empty values, the
`FindingExtractionCard` should render nothing (not even the card header).

## Preconditions

- A `CustomDetectorExtraction` record exists for the finding.
- `extractedData` is either `{}` or has all null/empty/empty-array values.

## Steps

1. Navigate to `/findings/{findingId}`.
2. Look for the "Extracted Data" card.

## Expected Results

| Check                                    | Expected                |
| ---------------------------------------- | ----------------------- |
| "Extracted Data" card is **not** visible | ✅ card hidden entirely |
| No empty card header is shown            | ✅ no orphaned card     |

## Test Data

```json
{
  "extractedData": {
    "dish": null,
    "cuisine": "",
    "tags": []
  },
  "extractionMethod": "REGEX"
}
```

## Rationale

Showing an empty card with "No fields populated" could be confusing — users would expect
the extraction to have produced something if the card is rendered. The component should
be invisible rather than showing a no-data state.

> **Note:** The component currently hides itself when entries are empty, but the
> internal `EmptyState` branch (lines 79–86 of `finding-extraction-card.tsx`) is
> unreachable because `entries.length === 0` already returns `null` at line 58.
> This is a minor dead-code issue — the internal empty state is never shown.

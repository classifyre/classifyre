# Scenario 10 (GAP) — Findings List Should Show Extraction Badge

## Status: ⚠️ GAP — Not Yet Implemented

## Summary

The findings list page (`/findings`) currently shows no indication that a finding has
extraction data. Users must open each finding individually to discover extracted fields.

## Proposed Behavior

Findings rows that have an associated `CustomDetectorExtraction` should show a small badge
or chip such as `"⊞ 3 fields"` or an "Extracted" indicator.

## User Value

- Quickly identify which findings have rich structured data without opening each one.
- Enable filtering/sorting by "has extraction" to surface the most data-rich findings.

## Proposed Implementation Options

### Option A: Badge in findings table row

Add an "Extracted" badge in the custom detector findings table column when
`findingId` has an extraction. Requires a bulk check API or including `hasExtraction`
in the findings list response.

### Option B: `hasExtraction` flag in findings list API

Extend `FindingDto` to include:

```ts
extractionFieldCount?: number  // 0 = no extraction, >0 = extraction exists
```

Return this from `GET /findings` by doing a LEFT JOIN on `CustomDetectorExtraction`.

### Option C: Dedicated "Extractions" tab on detector page

Instead of modifying the findings list, add a tab to `/detectors/[id]` that shows
a table of all extractions with field values inline.

## Priority

Medium — useful once detectors with extractors are actively used in production.

## Related

- `FindingExtractionCard` at `/findings/[id]` — already implemented (Scenario 01).
- `search_extractions` MCP tool — can already filter by populated field.

# Scenario 06 — Extractor Disabled Flag

## Summary

When `config.extractor.enabled = false`, the CLI should not run extraction and
no `CustomDetectorExtraction` record should be created. The finding detail page
should not show the extraction card.

## Preconditions

- A detector has `config.extractor` present but `enabled: false`.
- A finding was produced by this detector.

## Steps

1. Trigger a scan that produces findings from this detector.
2. Navigate to `/findings/{findingId}`.
3. Check for "Extracted Data" card.

## Expected Results

| Check                                              | Expected |
| -------------------------------------------------- | -------- |
| No `CustomDetectorExtraction` record created in DB | ✅       |
| `GET /findings/{findingId}/extraction` returns 404 | ✅       |
| No "Extracted Data" card on finding page           | ✅       |

## CLI Behavior

`CustomExtractor.extract()` returns `None` immediately when `config.enabled = False`
(see `test_disabled_extractor_returns_none` in `test_custom_extractor.py`).

## Config Example

```json
{
  "extractor": {
    "enabled": false,
    "fields": [{ "id": "dish", "name": "dish", "type": "list[string]" }]
  }
}
```

## Notes

The UI editor toggle for enabling/disabling the extractor is in `custom-detector-editor.tsx`
around line 2132. When toggled off, `enabled: false` is written to the config.

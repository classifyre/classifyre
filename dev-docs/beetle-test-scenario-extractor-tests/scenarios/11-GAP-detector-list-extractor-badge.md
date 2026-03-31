# Scenario 11 (GAP) — Detector List Should Show Extractor Configured Badge

## Status: ⚠️ GAP — Not Yet Implemented

## Summary

The `/detectors` list page shows detector name, method, status, and counts — but gives
no indication of whether a detector has an extractor configured. Users must open each
detector to discover this.

## Proposed Behavior

Detector rows where `config.extractor?.enabled === true` should display an "Extractor"
badge (e.g., `⊞ Extractor`) alongside the existing method badge.

## Proposed Implementation

In `custom-detectors-table.tsx` (or wherever the detector row is rendered), add:

```tsx
{
  detector.config?.extractor?.enabled && (
    <Badge variant="secondary" className="text-xs">
      Extractor
    </Badge>
  );
}
```

Or show the field count:

```tsx
{
  extractorFields.length > 0 && (
    <Badge variant="outline" className="text-xs font-mono">
      {extractorFields.length} fields
    </Badge>
  );
}
```

## User Value

- At a glance, distinguish "plain" detectors from "smart extraction" detectors.
- Helps users understand which detectors produce structured data vs. just flags.

## Priority

Low — cosmetic improvement. The detector detail page already shows extraction coverage.

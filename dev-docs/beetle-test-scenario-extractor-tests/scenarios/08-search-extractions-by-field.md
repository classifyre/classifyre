# Scenario 08 — Search Extractions by Populated Field

## Summary

The `search_extractions` API (and MCP tool) supports filtering by `populated_field`,
returning only extractions where that field has a value.

## API Endpoint

`GET /custom-detectors/{detectorId}/extractions?populated_field=cuisine`

## Steps

1. Ensure multiple extractions exist: some with `cuisine` populated, some without.
2. Call the endpoint with `populated_field=cuisine`.
3. Verify only extractions with `cuisine` in `populatedFields` array are returned.

## Expected Results

| Check                                                                                  | Expected |
| -------------------------------------------------------------------------------------- | -------- |
| Response `items` only contain extractions where `populatedFields` includes `"cuisine"` | ✅       |
| Response `total` reflects the filtered count                                           | ✅       |
| Extractions without `cuisine` populated are absent                                     | ✅       |

## Prisma Query Used

```ts
where: {
  populatedFields: {
    has: "cuisine";
  }
}
```

## Test Data Setup

```
Extraction A: populatedFields = ["dish", "cuisine"]    ← included
Extraction B: populatedFields = ["dish"]               ← excluded
Extraction C: populatedFields = ["cuisine", "rating"]  ← included
```

Filter `populated_field=cuisine` → returns A and C.

## MCP Tool Equivalent

```
search_extractions(custom_detector_key: "food_discussion", populated_field: "cuisine")
```

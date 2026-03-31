# Scenario 07 — Field Type Rendering on Finding Detail

## Summary

The `FindingExtractionCard` renders extracted values using `renderFieldValue()`.
Different value types must render correctly.

## Type Rendering Rules

| Value type            | Rendered output                                                               |
| --------------------- | ----------------------------------------------------------------------------- |
| `null` or `undefined` | `"—"` (em dash) — but these fields are **filtered out** by the entries filter |
| `string`              | The string as-is                                                              |
| `number`              | String representation, e.g. `"42"`                                            |
| `boolean`             | `"true"` or `"false"`                                                         |
| `string[]`            | Comma-joined: `"pasta, pizza"`                                                |
| `number[]`            | Comma-joined: `"1, 2, 3"`                                                     |
| `object`              | JSON stringified                                                              |

## Test Cases

### TC-07-1: String field

Input: `{ "cuisine": "Italian" }`
Expected: row shows `cuisine` label and `Italian` text.

### TC-07-2: List of strings

Input: `{ "dishes": ["pasta carbonara", "tiramisu"] }`
Expected: row shows `dishes` label and `pasta carbonara, tiramisu` text.

### TC-07-3: Empty array filtered out

Input: `{ "dishes": [], "cuisine": "Italian" }`
Expected: only `cuisine` row visible; `dishes` row absent.

### TC-07-4: Number

Input: `{ "price": 29.99 }`
Expected: row shows `price` and `29.99`.

### TC-07-5: Boolean

Input: `{ "is_vegetarian": true }`
Expected: row shows `is_vegetarian` and `true`.

### TC-07-6: Null value filtered out

Input: `{ "rating": null, "cuisine": "French" }`
Expected: only `cuisine` row; `rating` absent.

### TC-07-7: Empty string filtered out

Input: `{ "source": "", "cuisine": "Mexican" }`
Expected: only `cuisine` row; `source` absent.

## Notes

Filtering logic is in `finding-extraction-card.tsx` lines 54–57:

```ts
const entries = Object.entries(extraction.extractedData).filter(
  ([, v]) => v !== null && v !== undefined && v !== "",
);
```

Array emptiness is NOT filtered here — empty arrays `[]` pass the filter but are rendered
as an empty string by `Array.join(", ")`. This is a **minor bug** — empty arrays should
also be filtered. (See Scenario 02 for the component-level behavior.)

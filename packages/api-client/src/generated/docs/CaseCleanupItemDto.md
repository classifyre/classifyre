
# CaseCleanupItemDto


## Properties

Name | Type
------------ | -------------
`reason` | string
`state` | string
`label` | string
`value` | string
`assetLabel` | string
`filterId` | string

## Example

```typescript
import type { CaseCleanupItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "reason": null,
  "state": null,
  "label": null,
  "value": null,
  "assetLabel": null,
  "filterId": null,
} satisfies CaseCleanupItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseCleanupItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



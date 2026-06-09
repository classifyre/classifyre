
# EvidenceEntityDto


## Properties

Name | Type
------------ | -------------
`id` | string
`label` | string
`assetType` | string
`sourceType` | string

## Example

```typescript
import type { EvidenceEntityDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "label": null,
  "assetType": null,
  "sourceType": null,
} satisfies EvidenceEntityDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EvidenceEntityDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



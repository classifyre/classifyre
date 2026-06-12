
# IngestEdgeDto


## Properties

Name | Type
------------ | -------------
`fromType` | string
`fromId` | string
`fromHash` | string
`toType` | string
`toId` | string
`toHash` | string
`relationType` | string
`confidence` | number

## Example

```typescript
import type { IngestEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromType": null,
  "fromId": null,
  "fromHash": null,
  "toType": null,
  "toId": null,
  "toHash": null,
  "relationType": null,
  "confidence": null,
} satisfies IngestEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as IngestEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



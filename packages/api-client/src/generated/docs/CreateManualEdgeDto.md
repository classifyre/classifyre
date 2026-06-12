
# CreateManualEdgeDto


## Properties

Name | Type
------------ | -------------
`fromType` | string
`fromId` | string
`toType` | string
`toId` | string
`relationType` | string
`confidence` | number

## Example

```typescript
import type { CreateManualEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromType": null,
  "fromId": null,
  "toType": null,
  "toId": null,
  "relationType": null,
  "confidence": null,
} satisfies CreateManualEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateManualEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



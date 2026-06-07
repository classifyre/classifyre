
# GraphEdgeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`fromType` | string
`fromId` | string
`toType` | string
`toId` | string
`relationType` | string
`confidence` | number
`origin` | string

## Example

```typescript
import type { GraphEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "fromType": null,
  "fromId": null,
  "toType": null,
  "toId": null,
  "relationType": null,
  "confidence": null,
  "origin": null,
} satisfies GraphEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GraphEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



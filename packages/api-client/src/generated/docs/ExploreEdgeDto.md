
# ExploreEdgeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`fromType` | string
`fromId` | string
`toType` | string
`toId` | string
`kind` | [ExploreKind](ExploreKind.md)
`relationType` | string
`relationClass` | string
`confidence` | number
`origin` | string
`sharedByLabel` | { [key: string]: number; }
`note` | string
`passage` | string
`review` | string

## Example

```typescript
import type { ExploreEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "fromType": null,
  "fromId": null,
  "toType": null,
  "toId": null,
  "kind": null,
  "relationType": null,
  "relationClass": null,
  "confidence": null,
  "origin": null,
  "sharedByLabel": null,
  "note": null,
  "passage": null,
  "review": null,
} satisfies ExploreEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



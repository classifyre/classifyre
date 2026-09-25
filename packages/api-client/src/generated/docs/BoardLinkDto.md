
# BoardLinkDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sourceItemId` | string
`sourceFindingId` | string
`targetItemId` | string
`targetFindingId` | string
`kind` | string
`label` | string
`certainty` | [BoardLinkCertainty](BoardLinkCertainty.md)
`confidence` | number
`note` | string
`promotedEdgeId` | string
`createdBy` | string
`updatedBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { BoardLinkDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sourceItemId": null,
  "sourceFindingId": null,
  "targetItemId": null,
  "targetFindingId": null,
  "kind": null,
  "label": null,
  "certainty": null,
  "confidence": null,
  "note": null,
  "promotedEdgeId": null,
  "createdBy": null,
  "updatedBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies BoardLinkDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardLinkDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



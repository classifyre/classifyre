
# BoardSupportDto


## Properties

Name | Type
------------ | -------------
`id` | string
`threadId` | string
`targetType` | string
`targetId` | string
`stance` | [EvidenceStance](EvidenceStance.md)
`weight` | number
`note` | string
`endpoint` | [BoardEndpointDto](BoardEndpointDto.md)
`createdAt` | Date

## Example

```typescript
import type { BoardSupportDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "threadId": null,
  "targetType": null,
  "targetId": null,
  "stance": null,
  "weight": null,
  "note": null,
  "endpoint": null,
  "createdAt": null,
} satisfies BoardSupportDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardSupportDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



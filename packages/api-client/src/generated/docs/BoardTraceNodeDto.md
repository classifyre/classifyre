
# BoardTraceNodeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`type` | string
`label` | string
`assetType` | string
`sourceType` | string
`sourceName` | string
`status` | string
`missing` | boolean
`depth` | number
`side` | [BoardTraceSide](BoardTraceSide.md)
`via` | string
`viaKind` | [BoardTraceKind](BoardTraceKind.md)

## Example

```typescript
import type { BoardTraceNodeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "type": null,
  "label": null,
  "assetType": null,
  "sourceType": null,
  "sourceName": null,
  "status": null,
  "missing": null,
  "depth": null,
  "side": null,
  "via": null,
  "viaKind": null,
} satisfies BoardTraceNodeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardTraceNodeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)




# PivotGraphDto


## Properties

Name | Type
------------ | -------------
`entityType` | string
`entityId` | string
`pivot` | string
`depth` | number

## Example

```typescript
import type { PivotGraphDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "entityType": null,
  "entityId": null,
  "pivot": null,
  "depth": null,
} satisfies PivotGraphDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PivotGraphDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



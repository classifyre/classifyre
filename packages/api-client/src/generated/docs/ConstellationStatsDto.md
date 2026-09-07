
# ConstellationStatsDto


## Properties

Name | Type
------------ | -------------
`refreshedAt` | Date
`isBuilt` | boolean
`source` | string

## Example

```typescript
import type { ConstellationStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "refreshedAt": null,
  "isBuilt": null,
  "source": null,
} satisfies ConstellationStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



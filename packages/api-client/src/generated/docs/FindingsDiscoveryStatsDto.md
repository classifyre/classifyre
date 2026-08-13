
# FindingsDiscoveryStatsDto


## Properties

Name | Type
------------ | -------------
`refreshedAt` | Date
`durationMs` | number
`isBuilt` | boolean
`source` | string

## Example

```typescript
import type { FindingsDiscoveryStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "refreshedAt": null,
  "durationMs": null,
  "isBuilt": null,
  "source": null,
} satisfies FindingsDiscoveryStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoveryStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



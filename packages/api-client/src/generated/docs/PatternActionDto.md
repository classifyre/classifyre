
# PatternActionDto


## Properties

Name | Type
------------ | -------------
`verdict` | string
`min` | number
`max` | number
`lineage` | string
`excludeLabel` | string

## Example

```typescript
import type { PatternActionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "verdict": null,
  "min": null,
  "max": null,
  "lineage": null,
  "excludeLabel": null,
} satisfies PatternActionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PatternActionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



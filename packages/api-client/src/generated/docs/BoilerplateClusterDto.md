
# BoilerplateClusterDto


## Properties

Name | Type
------------ | -------------
`groupHash` | string
`findingCount` | number
`findingIds` | Array&lt;string&gt;
`meanImportance` | number
`threshold` | number

## Example

```typescript
import type { BoilerplateClusterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "groupHash": null,
  "findingCount": null,
  "findingIds": null,
  "meanImportance": null,
  "threshold": null,
} satisfies BoilerplateClusterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoilerplateClusterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



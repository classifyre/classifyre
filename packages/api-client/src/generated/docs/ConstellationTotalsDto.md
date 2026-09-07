
# ConstellationTotalsDto


## Properties

Name | Type
------------ | -------------
`sources` | number
`assets` | number
`connectedAssets` | number
`isolatedAssets` | number
`crossSourceLinks` | number

## Example

```typescript
import type { ConstellationTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sources": null,
  "assets": null,
  "connectedAssets": null,
  "isolatedAssets": null,
  "crossSourceLinks": null,
} satisfies ConstellationTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



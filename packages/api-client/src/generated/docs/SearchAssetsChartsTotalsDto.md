
# SearchAssetsChartsTotalsDto


## Properties

Name | Type
------------ | -------------
`totalAssets` | number
`newAssets` | number
`updatedAssets` | number
`unchangedAssets` | number

## Example

```typescript
import type { SearchAssetsChartsTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totalAssets": null,
  "newAssets": null,
  "updatedAssets": null,
  "unchangedAssets": null,
} satisfies SearchAssetsChartsTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsChartsTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



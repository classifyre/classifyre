
# AssetColumnsDto


## Properties

Name | Type
------------ | -------------
`columns` | [Array&lt;AssetColumnDto&gt;](AssetColumnDto.md)
`removed` | [Array&lt;AssetColumnDto&gt;](AssetColumnDto.md)
`findingsWithoutColumn` | number
`classificationReviewed` | boolean
`canGovern` | boolean

## Example

```typescript
import type { AssetColumnsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "columns": null,
  "removed": null,
  "findingsWithoutColumn": null,
  "classificationReviewed": null,
  "canGovern": null,
} satisfies AssetColumnsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetColumnsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



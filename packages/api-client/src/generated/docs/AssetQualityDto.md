
# AssetQualityDto


## Properties

Name | Type
------------ | -------------
`rules` | [Array&lt;QualityRuleDto&gt;](QualityRuleDto.md)
`score` | number
`dimensions` | [Array&lt;QualityDimensionDto&gt;](QualityDimensionDto.md)
`failing` | number
`lastEvaluatedAt` | Date
`measuring` | boolean
`canGovern` | boolean

## Example

```typescript
import type { AssetQualityDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "rules": null,
  "score": null,
  "dimensions": null,
  "failing": null,
  "lastEvaluatedAt": null,
  "measuring": null,
  "canGovern": null,
} satisfies AssetQualityDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetQualityDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



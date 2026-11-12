
# QualityRuleArgumentsDto


## Properties

Name | Type
------------ | -------------
`missingValues` | [Array&lt;QualityRuleArgumentsDtoMissingValuesInner&gt;](QualityRuleArgumentsDtoMissingValuesInner.md)
`validValues` | [Array&lt;QualityRuleArgumentsDtoMissingValuesInner&gt;](QualityRuleArgumentsDtoMissingValuesInner.md)
`pattern` | string
`properties` | Array&lt;string&gt;
`query` | string
`detectorType` | string
`customDetectorKey` | string
`findingType` | string
`category` | string

## Example

```typescript
import type { QualityRuleArgumentsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "missingValues": null,
  "validValues": null,
  "pattern": null,
  "properties": null,
  "query": null,
  "detectorType": PII,
  "customDetectorKey": null,
  "findingType": EMAIL_ADDRESS,
  "category": QUALITY,
} satisfies QualityRuleArgumentsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityRuleArgumentsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



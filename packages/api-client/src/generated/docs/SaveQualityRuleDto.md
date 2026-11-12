
# SaveQualityRuleDto


## Properties

Name | Type
------------ | -------------
`key` | string
`name` | string
`description` | string
`columnName` | string
`dimension` | string
`type` | string
`metric` | string
`arguments` | [QualityRuleArgumentsDto](QualityRuleArgumentsDto.md)
`unit` | string
`schedule` | string
`operator` | string
`threshold` | [SaveQualityRuleDtoThreshold](SaveQualityRuleDtoThreshold.md)
`severity` | string
`businessImpact` | string
`enabled` | boolean

## Example

```typescript
import type { SaveQualityRuleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "key": null,
  "name": null,
  "description": null,
  "columnName": null,
  "dimension": null,
  "type": null,
  "metric": null,
  "arguments": null,
  "unit": null,
  "schedule": null,
  "operator": null,
  "threshold": null,
  "severity": null,
  "businessImpact": null,
  "enabled": null,
} satisfies SaveQualityRuleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SaveQualityRuleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



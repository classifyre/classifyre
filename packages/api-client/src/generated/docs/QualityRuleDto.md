
# QualityRuleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`name` | string
`description` | string
`columnName` | string
`dimension` | string
`type` | string
`metric` | string
`arguments` | [QualityRuleArgumentsDto](QualityRuleArgumentsDto.md)
`operator` | string
`threshold` | [QualityRuleDtoThreshold](QualityRuleDtoThreshold.md)
`unit` | string
`severity` | string
`businessImpact` | string
`enabled` | boolean
`schedule` | string
`createdBy` | string
`updatedAt` | Date
`latest` | [QualityResultDto](QualityResultDto.md)
`history` | [Array&lt;QualityResultDto&gt;](QualityResultDto.md)
`findingId` | string

## Example

```typescript
import type { QualityRuleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "name": null,
  "description": null,
  "columnName": null,
  "dimension": null,
  "type": null,
  "metric": null,
  "arguments": null,
  "operator": null,
  "threshold": null,
  "unit": findings,
  "severity": null,
  "businessImpact": null,
  "enabled": null,
  "schedule": null,
  "createdBy": null,
  "updatedAt": null,
  "latest": null,
  "history": null,
  "findingId": null,
} satisfies QualityRuleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityRuleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



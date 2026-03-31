
# CreateMetricDefinitionDto


## Properties

Name | Type
------------ | -------------
`displayName` | string
`description` | string
`type` | string
`definition` | object
`allowedDimensions` | Array&lt;string&gt;
`glossaryTermId` | string
`format` | string
`unit` | string
`color` | string
`owner` | string

## Example

```typescript
import type { CreateMetricDefinitionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "displayName": False Positive Rate,
  "description": Percentage of findings marked as false positive out of total findings,
  "type": RATIO,
  "definition": {"numerator":{"aggregation":"COUNT","entity":"finding","filters":{"statuses":["FALSE_POSITIVE"]}},"denominator":{"aggregation":"COUNT","entity":"finding"}},
  "allowedDimensions": ["severity","detectorType","source"],
  "glossaryTermId": null,
  "format": percentage,
  "unit": %,
  "color": null,
  "owner": null,
} satisfies CreateMetricDefinitionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateMetricDefinitionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



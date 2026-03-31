
# QueryMetricTimeSeriesDto


## Properties

Name | Type
------------ | -------------
`metricId` | string
`dimensions` | Array&lt;string&gt;
`filters` | object
`from` | string
`to` | string
`glossaryTermId` | string
`granularity` | string

## Example

```typescript
import type { QueryMetricTimeSeriesDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "metricId": a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  "dimensions": ["severity","detectorType"],
  "filters": {"sourceIds":["src-1"],"severities":["CRITICAL","HIGH"]},
  "from": null,
  "to": null,
  "glossaryTermId": null,
  "granularity": day,
} satisfies QueryMetricTimeSeriesDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryMetricTimeSeriesDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



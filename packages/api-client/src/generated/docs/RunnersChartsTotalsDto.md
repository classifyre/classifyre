
# RunnersChartsTotalsDto


## Properties

Name | Type
------------ | -------------
`totalRuns` | number
`running` | number
`queued` | number
`completed` | number
`failed` | number

## Example

```typescript
import type { RunnersChartsTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totalRuns": null,
  "running": null,
  "queued": null,
  "completed": null,
  "failed": null,
} satisfies RunnersChartsTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnersChartsTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



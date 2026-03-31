
# RunnersChartsTimelineBucketDto


## Properties

Name | Type
------------ | -------------
`date` | string
`total` | number
`running` | number
`queued` | number
`completed` | number
`failed` | number

## Example

```typescript
import type { RunnersChartsTimelineBucketDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "date": null,
  "total": null,
  "running": null,
  "queued": null,
  "completed": null,
  "failed": null,
} satisfies RunnersChartsTimelineBucketDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnersChartsTimelineBucketDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



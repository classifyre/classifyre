
# UpdateRunnerLimitsDto


## Properties

Name | Type
------------ | -------------
`maxRunnersPerSource` | number
`maxConcurrentRunners` | number
`autoScheduleMaxConcurrent` | number

## Example

```typescript
import type { UpdateRunnerLimitsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "maxRunnersPerSource": null,
  "maxConcurrentRunners": null,
  "autoScheduleMaxConcurrent": null,
} satisfies UpdateRunnerLimitsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateRunnerLimitsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



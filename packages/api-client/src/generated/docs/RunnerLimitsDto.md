
# RunnerLimitsDto


## Properties

Name | Type
------------ | -------------
`maxRunnersPerSource` | [RunnerLimitDto](RunnerLimitDto.md)
`maxConcurrentRunners` | [RunnerLimitDto](RunnerLimitDto.md)
`autoScheduleMaxConcurrent` | [RunnerLimitDto](RunnerLimitDto.md)

## Example

```typescript
import type { RunnerLimitsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "maxRunnersPerSource": null,
  "maxConcurrentRunners": null,
  "autoScheduleMaxConcurrent": null,
} satisfies RunnerLimitsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerLimitsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



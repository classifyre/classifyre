
# SearchSourceItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`type` | string
`runnerStatus` | string
`latestRunner` | [LatestRunnerSummaryDto](LatestRunnerSummaryDto.md)
`createdAt` | Date
`updatedAt` | Date
`scheduleEnabled` | boolean
`scheduleCron` | string
`scheduleTimezone` | string
`scheduleNextAt` | Date

## Example

```typescript
import type { SearchSourceItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "type": null,
  "runnerStatus": null,
  "latestRunner": null,
  "createdAt": null,
  "updatedAt": null,
  "scheduleEnabled": false,
  "scheduleCron": 30 1 * * *,
  "scheduleTimezone": UTC,
  "scheduleNextAt": null,
} satisfies SearchSourceItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchSourceItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



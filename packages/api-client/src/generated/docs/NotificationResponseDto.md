
# NotificationResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`type` | string
`event` | string
`severity` | string
`title` | string
`message` | string
`actionUrl` | string
`sourceId` | string
`sourceName` | string
`runnerId` | string
`findingId` | string
`triggeredBy` | string
`read` | boolean
`readAt` | Date
`important` | boolean
`metadata` | object
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { NotificationResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "type": null,
  "event": null,
  "severity": null,
  "title": null,
  "message": null,
  "actionUrl": null,
  "sourceId": null,
  "sourceName": null,
  "runnerId": null,
  "findingId": null,
  "triggeredBy": null,
  "read": null,
  "readAt": null,
  "important": null,
  "metadata": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies NotificationResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotificationResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



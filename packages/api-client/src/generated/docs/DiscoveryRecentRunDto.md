
# DiscoveryRecentRunDto


## Properties

Name | Type
------------ | -------------
`id` | string
`status` | string
`triggerType` | string
`triggeredAt` | Date
`startedAt` | Date
`completedAt` | Date
`durationMs` | number
`totalFindings` | number
`assetsCreated` | number
`assetsUpdated` | number
`errorMessage` | string
`source` | [DiscoveryRunSourceDto](DiscoveryRunSourceDto.md)

## Example

```typescript
import type { DiscoveryRecentRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "status": null,
  "triggerType": null,
  "triggeredAt": null,
  "startedAt": null,
  "completedAt": null,
  "durationMs": null,
  "totalFindings": null,
  "assetsCreated": null,
  "assetsUpdated": null,
  "errorMessage": null,
  "source": null,
} satisfies DiscoveryRecentRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DiscoveryRecentRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



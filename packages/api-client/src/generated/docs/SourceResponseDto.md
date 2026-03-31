
# SourceResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`type` | string
`config` | object
`currentRunnerId` | string
`runnerStatus` | string
`createdAt` | Date
`updatedAt` | Date
`scheduleEnabled` | boolean
`scheduleCron` | string
`scheduleTimezone` | string
`scheduleNextAt` | Date

## Example

```typescript
import type { SourceResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  "name": Production WordPress,
  "type": WORDPRESS,
  "config": null,
  "currentRunnerId": null,
  "runnerStatus": PENDING,
  "createdAt": 2026-01-31T10:00Z,
  "updatedAt": 2026-01-31T10:00Z,
  "scheduleEnabled": false,
  "scheduleCron": 30 1 * * *,
  "scheduleTimezone": UTC,
  "scheduleNextAt": null,
} satisfies SourceResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourceResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



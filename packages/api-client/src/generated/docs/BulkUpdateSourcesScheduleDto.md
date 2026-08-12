
# BulkUpdateSourcesScheduleDto


## Properties

Name | Type
------------ | -------------
`mode` | string
`cron` | string
`timezone` | string

## Example

```typescript
import type { BulkUpdateSourcesScheduleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "mode": null,
  "cron": 30 1 * * *,
  "timezone": UTC,
} satisfies BulkUpdateSourcesScheduleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkUpdateSourcesScheduleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



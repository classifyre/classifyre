
# QueryRunDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sql` | string
`status` | string
`actorRef` | string
`assetIds` | Array&lt;string&gt;
`rowCount` | number
`truncated` | boolean
`truncatedReason` | string
`columns` | [Array&lt;QueryColumnDto&gt;](QueryColumnDto.md)
`timings` | { [key: string]: number; }
`error` | [QueryRunErrorDto](QueryRunErrorDto.md)
`resultBytes` | number
`resultFormat` | string
`createdAt` | Date
`startedAt` | Date
`finishedAt` | Date

## Example

```typescript
import type { QueryRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sql": null,
  "status": null,
  "actorRef": null,
  "assetIds": null,
  "rowCount": null,
  "truncated": null,
  "truncatedReason": null,
  "columns": null,
  "timings": null,
  "error": null,
  "resultBytes": null,
  "resultFormat": null,
  "createdAt": null,
  "startedAt": null,
  "finishedAt": null,
} satisfies QueryRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



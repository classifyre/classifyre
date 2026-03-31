
# RunnerLogsResponseDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`entries` | [Array&lt;RunnerLogEntryDto&gt;](RunnerLogEntryDto.md)
`nextCursor` | string
`cursor` | string
`hasMore` | boolean
`take` | number

## Example

```typescript
import type { RunnerLogsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": null,
  "entries": null,
  "nextCursor": null,
  "cursor": null,
  "hasMore": null,
  "take": null,
} satisfies RunnerLogsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerLogsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



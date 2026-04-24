
# SearchRunnerLogsBodyDto


## Properties

Name | Type
------------ | -------------
`cursor` | string
`take` | number
`search` | string
`levels` | Array&lt;string&gt;
`sortOrder` | string
`streams` | Array&lt;string&gt;

## Example

```typescript
import type { SearchRunnerLogsBodyDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "cursor": null,
  "take": null,
  "search": null,
  "levels": null,
  "sortOrder": null,
  "streams": null,
} satisfies SearchRunnerLogsBodyDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchRunnerLogsBodyDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



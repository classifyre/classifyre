
# QuickSearchRequestDto


## Properties

Name | Type
------------ | -------------
`q` | string
`kinds` | Array&lt;string&gt;
`sourceId` | string
`severity` | Array&lt;string&gt;
`detectorType` | Array&lt;string&gt;
`limit` | number

## Example

```typescript
import type { QuickSearchRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "q": null,
  "kinds": null,
  "sourceId": null,
  "severity": null,
  "detectorType": null,
  "limit": null,
} satisfies QuickSearchRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QuickSearchRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



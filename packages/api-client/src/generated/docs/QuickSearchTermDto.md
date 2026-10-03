
# QuickSearchTermDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`term` | string
`kind` | string
`status` | string
`schemeName` | string
`matchedOn` | string

## Example

```typescript
import type { QuickSearchTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "term": null,
  "kind": null,
  "status": null,
  "schemeName": null,
  "matchedOn": null,
} satisfies QuickSearchTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QuickSearchTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



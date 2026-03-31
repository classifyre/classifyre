
# SearchRunnersFiltersInputDto


## Properties

Name | Type
------------ | -------------
`search` | string
`sourceId` | Array&lt;string&gt;
`sourceType` | Array&lt;string&gt;
`status` | Array&lt;string&gt;
`triggerType` | Array&lt;string&gt;
`triggeredBy` | Array&lt;string&gt;
`triggeredAfter` | Date
`triggeredBefore` | Date

## Example

```typescript
import type { SearchRunnersFiltersInputDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "search": null,
  "sourceId": null,
  "sourceType": null,
  "status": null,
  "triggerType": null,
  "triggeredBy": null,
  "triggeredAfter": null,
  "triggeredBefore": null,
} satisfies SearchRunnersFiltersInputDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchRunnersFiltersInputDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



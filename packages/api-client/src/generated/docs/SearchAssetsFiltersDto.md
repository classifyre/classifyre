
# SearchAssetsFiltersDto


## Properties

Name | Type
------------ | -------------
`search` | string
`sourceId` | string
`runnerId` | string
`status` | Array&lt;string&gt;
`sourceTypes` | Array&lt;string&gt;

## Example

```typescript
import type { SearchAssetsFiltersDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "search": null,
  "sourceId": null,
  "runnerId": null,
  "status": null,
  "sourceTypes": null,
} satisfies SearchAssetsFiltersDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsFiltersDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



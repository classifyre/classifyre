
# ExploreDuplicatesFilterDto


## Properties

Name | Type
------------ | -------------
`patternKey` | string
`family` | string
`minScore` | number
`review` | string
`sourceId` | string

## Example

```typescript
import type { ExploreDuplicatesFilterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patternKey": null,
  "family": null,
  "minScore": null,
  "review": null,
  "sourceId": null,
} satisfies ExploreDuplicatesFilterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreDuplicatesFilterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



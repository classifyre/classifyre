
# GovernanceMeaningSuggestionDto


## Properties

Name | Type
------------ | -------------
`term` | [MeaningTermRefDto](MeaningTermRefDto.md)
`source` | string
`suggestionId` | string
`reason` | string
`score` | number

## Example

```typescript
import type { GovernanceMeaningSuggestionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "term": null,
  "source": null,
  "suggestionId": null,
  "reason": null,
  "score": null,
} satisfies GovernanceMeaningSuggestionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceMeaningSuggestionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



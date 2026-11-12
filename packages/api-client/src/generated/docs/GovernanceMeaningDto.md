
# GovernanceMeaningDto


## Properties

Name | Type
------------ | -------------
`terms` | [Array&lt;GovernanceMeaningTermDto&gt;](GovernanceMeaningTermDto.md)
`suggestions` | [Array&lt;GovernanceMeaningSuggestionDto&gt;](GovernanceMeaningSuggestionDto.md)
`canGovern` | boolean
`canEditGlossary` | boolean

## Example

```typescript
import type { GovernanceMeaningDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "terms": null,
  "suggestions": null,
  "canGovern": null,
  "canEditGlossary": null,
} satisfies GovernanceMeaningDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceMeaningDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



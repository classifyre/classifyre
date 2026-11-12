
# GovernanceMeaningTermDto


## Properties

Name | Type
------------ | -------------
`term` | [MeaningTermRefDto](MeaningTermRefDto.md)
`methods` | Array&lt;string&gt;
`referenceId` | string
`pending` | boolean

## Example

```typescript
import type { GovernanceMeaningTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "term": null,
  "methods": null,
  "referenceId": null,
  "pending": null,
} satisfies GovernanceMeaningTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceMeaningTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



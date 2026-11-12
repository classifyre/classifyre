
# MeaningTermRefDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`term` | string
`status` | string
`definition` | string

## Example

```typescript
import type { MeaningTermRefDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "term": null,
  "status": null,
  "definition": null,
} satisfies MeaningTermRefDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MeaningTermRefDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



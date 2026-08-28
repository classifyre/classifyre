
# UndoBatchResponseDto


## Properties

Name | Type
------------ | -------------
`batchId` | string
`reverted` | number
`workRemaining` | number

## Example

```typescript
import type { UndoBatchResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "batchId": null,
  "reverted": null,
  "workRemaining": null,
} satisfies UndoBatchResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UndoBatchResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



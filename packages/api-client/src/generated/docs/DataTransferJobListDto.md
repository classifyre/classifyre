
# DataTransferJobListDto


## Properties

Name | Type
------------ | -------------
`jobs` | [Array&lt;DataTransferJobDto&gt;](DataTransferJobDto.md)

## Example

```typescript
import type { DataTransferJobListDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "jobs": null,
} satisfies DataTransferJobListDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataTransferJobListDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



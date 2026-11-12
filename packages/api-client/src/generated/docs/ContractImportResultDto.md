
# ContractImportResultDto


## Properties

Name | Type
------------ | -------------
`applied` | [ContractAppliedDto](ContractAppliedDto.md)
`skipped` | [Array&lt;ContractSkippedDto&gt;](ContractSkippedDto.md)

## Example

```typescript
import type { ContractImportResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "applied": null,
  "skipped": null,
} satisfies ContractImportResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ContractImportResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



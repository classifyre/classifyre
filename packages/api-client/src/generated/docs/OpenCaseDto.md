
# OpenCaseDto


## Properties

Name | Type
------------ | -------------
`caseId` | string
`title` | string
`severity` | string

## Example

```typescript
import type { OpenCaseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "caseId": null,
  "title": null,
  "severity": null,
} satisfies OpenCaseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as OpenCaseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



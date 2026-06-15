
# CaseActionResponseDto


## Properties

Name | Type
------------ | -------------
`caseId` | string
`caseTitle` | string
`created` | boolean
`assetsAdded` | number
`findingsAttached` | number

## Example

```typescript
import type { CaseActionResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "caseId": null,
  "caseTitle": null,
  "created": null,
  "assetsAdded": null,
  "findingsAttached": null,
} satisfies CaseActionResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseActionResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



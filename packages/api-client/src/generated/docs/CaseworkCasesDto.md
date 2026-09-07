
# CaseworkCasesDto


## Properties

Name | Type
------------ | -------------
`byStatus` | [CaseworkCaseStatusBreakdownDto](CaseworkCaseStatusBreakdownDto.md)
`total` | number
`recent` | [Array&lt;CaseworkCaseDto&gt;](CaseworkCaseDto.md)

## Example

```typescript
import type { CaseworkCasesDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "byStatus": null,
  "total": null,
  "recent": null,
} satisfies CaseworkCasesDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseworkCasesDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



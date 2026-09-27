
# CaseCleanupResultDto


## Properties

Name | Type
------------ | -------------
`findingsRemoved` | number
`evidenceRemoved` | number
`findingsWithEvidence` | number

## Example

```typescript
import type { CaseCleanupResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "findingsRemoved": null,
  "evidenceRemoved": null,
  "findingsWithEvidence": null,
} satisfies CaseCleanupResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseCleanupResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



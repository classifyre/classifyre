
# CaseBoardMetaDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`version` | number
`readOnly` | boolean
`caseStatus` | string

## Example

```typescript
import type { CaseBoardMetaDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "version": null,
  "readOnly": null,
  "caseStatus": null,
} satisfies CaseBoardMetaDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseBoardMetaDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



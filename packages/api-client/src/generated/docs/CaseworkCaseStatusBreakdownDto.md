
# CaseworkCaseStatusBreakdownDto


## Properties

Name | Type
------------ | -------------
`open` | number
`inProgress` | number
`closed` | number
`archived` | number

## Example

```typescript
import type { CaseworkCaseStatusBreakdownDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "open": null,
  "inProgress": null,
  "closed": null,
  "archived": null,
} satisfies CaseworkCaseStatusBreakdownDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseworkCaseStatusBreakdownDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



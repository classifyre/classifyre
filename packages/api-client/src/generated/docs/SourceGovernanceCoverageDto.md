
# SourceGovernanceCoverageDto


## Properties

Name | Type
------------ | -------------
`assets` | number
`owned` | number
`active` | number
`checked` | number
`failing` | number

## Example

```typescript
import type { SourceGovernanceCoverageDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assets": null,
  "owned": null,
  "active": null,
  "checked": null,
  "failing": null,
} satisfies SourceGovernanceCoverageDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourceGovernanceCoverageDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



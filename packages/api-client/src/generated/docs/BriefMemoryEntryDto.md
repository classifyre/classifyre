
# BriefMemoryEntryDto


## Properties

Name | Type
------------ | -------------
`key` | string
`content` | string
`weight` | number

## Example

```typescript
import type { BriefMemoryEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "key": null,
  "content": null,
  "weight": null,
} satisfies BriefMemoryEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BriefMemoryEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



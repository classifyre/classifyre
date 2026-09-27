
# CaseFindingFilterOptionsDto


## Properties

Name | Type
------------ | -------------
`types` | [Array&lt;CaseFindingTypeOptionDto&gt;](CaseFindingTypeOptionDto.md)
`approximate` | boolean

## Example

```typescript
import type { CaseFindingFilterOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "types": null,
  "approximate": null,
} satisfies CaseFindingFilterOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseFindingFilterOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



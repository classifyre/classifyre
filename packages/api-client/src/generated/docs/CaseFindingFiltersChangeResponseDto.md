
# CaseFindingFiltersChangeResponseDto


## Properties

Name | Type
------------ | -------------
`filters` | [Array&lt;CaseFindingFilterDto&gt;](CaseFindingFilterDto.md)
`detached` | number
`escalated` | number
`assetsRemoved` | number

## Example

```typescript
import type { CaseFindingFiltersChangeResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "filters": null,
  "detached": null,
  "escalated": null,
  "assetsRemoved": null,
} satisfies CaseFindingFiltersChangeResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseFindingFiltersChangeResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



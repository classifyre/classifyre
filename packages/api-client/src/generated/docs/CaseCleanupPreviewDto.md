
# CaseCleanupPreviewDto


## Properties

Name | Type
------------ | -------------
`goneFindings` | number
`resolvedFindings` | number
`goneAssets` | number
`findingsWithAssets` | number
`sample` | [Array&lt;CaseCleanupItemDto&gt;](CaseCleanupItemDto.md)

## Example

```typescript
import type { CaseCleanupPreviewDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "goneFindings": null,
  "resolvedFindings": null,
  "goneAssets": null,
  "findingsWithAssets": null,
  "sample": null,
} satisfies CaseCleanupPreviewDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseCleanupPreviewDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



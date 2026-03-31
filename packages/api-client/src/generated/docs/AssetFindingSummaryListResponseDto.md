
# AssetFindingSummaryListResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;AssetFindingSummaryDto&gt;](AssetFindingSummaryDto.md)
`totalAssets` | number
`totalFindings` | number
`skip` | number
`limit` | number

## Example

```typescript
import type { AssetFindingSummaryListResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "totalAssets": null,
  "totalFindings": null,
  "skip": null,
  "limit": null,
} satisfies AssetFindingSummaryListResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetFindingSummaryListResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)




# SearchSourcesResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;SearchSourceItemDto&gt;](SearchSourceItemDto.md)
`total` | number
`skip` | number
`limit` | number
`totals` | [SearchSourcesTotalsDto](SearchSourcesTotalsDto.md)

## Example

```typescript
import type { SearchSourcesResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "total": null,
  "skip": null,
  "limit": null,
  "totals": null,
} satisfies SearchSourcesResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchSourcesResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



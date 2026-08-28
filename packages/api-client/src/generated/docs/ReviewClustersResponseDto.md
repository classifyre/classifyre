
# ReviewClustersResponseDto


## Properties

Name | Type
------------ | -------------
`rows` | [Array&lt;ReviewClusterRowDto&gt;](ReviewClusterRowDto.md)
`nextCursor` | string
`total` | number

## Example

```typescript
import type { ReviewClustersResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "rows": null,
  "nextCursor": null,
  "total": null,
} satisfies ReviewClustersResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewClustersResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



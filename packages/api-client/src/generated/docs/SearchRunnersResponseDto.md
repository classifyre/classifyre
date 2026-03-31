
# SearchRunnersResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;SearchRunnerItemDto&gt;](SearchRunnerItemDto.md)
`total` | number
`skip` | number
`limit` | number

## Example

```typescript
import type { SearchRunnersResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "total": null,
  "skip": null,
  "limit": null,
} satisfies SearchRunnersResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchRunnersResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



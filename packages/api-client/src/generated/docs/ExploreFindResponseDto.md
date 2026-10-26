
# ExploreFindResponseDto


## Properties

Name | Type
------------ | -------------
`hits` | [Array&lt;ExploreFindHitDto&gt;](ExploreFindHitDto.md)
`meaning` | string

## Example

```typescript
import type { ExploreFindResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "hits": null,
  "meaning": null,
} satisfies ExploreFindResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreFindResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



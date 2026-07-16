
# AssetChunkDto


## Properties

Name | Type
------------ | -------------
`ordinal` | number
`page` | number
`charOffset` | number
`charLength` | number
`text` | string

## Example

```typescript
import type { AssetChunkDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ordinal": null,
  "page": null,
  "charOffset": null,
  "charLength": null,
  "text": null,
} satisfies AssetChunkDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetChunkDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



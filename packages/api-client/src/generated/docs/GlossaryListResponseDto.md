
# GlossaryListResponseDto


## Properties

Name | Type
------------ | -------------
`terms` | [Array&lt;GlossaryTermDto&gt;](GlossaryTermDto.md)
`total` | number

## Example

```typescript
import type { GlossaryListResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "terms": null,
  "total": null,
} satisfies GlossaryListResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GlossaryListResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)



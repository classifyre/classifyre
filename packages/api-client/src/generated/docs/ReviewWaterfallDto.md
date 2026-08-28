
# ReviewWaterfallDto


## Properties

Name | Type
------------ | -------------
`rows` | [Array&lt;ReviewWaterfallRowDto&gt;](ReviewWaterfallRowDto.md)
`total` | number
`perfect` | number
`storedScore` | number
`phonetic` | boolean

## Example

```typescript
import type { ReviewWaterfallDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "rows": null,
  "total": null,
  "perfect": null,
  "storedScore": null,
  "phonetic": null,
} satisfies ReviewWaterfallDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewWaterfallDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


